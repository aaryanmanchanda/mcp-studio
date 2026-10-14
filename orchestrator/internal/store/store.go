// postgres-backed storage: saved pipelines and vault-encrypted credentials.
// nothing here ever returns a credential to a caller outside the orchestrator (see GetSecret's doc).
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mcpstudio/mcp_studio/orchestrator/internal/vault"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	pool *pgxpool.Pool
	key  []byte // the vault master key, 32 bytes, lives in memory only
}

// SecretRef names a stored credential without revealing it
type SecretRef struct {
	NodeID string
	Field  string
}

const schema = `
CREATE TABLE IF NOT EXISTS pipelines (
  id         TEXT PRIMARY KEY,
  graph_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secrets (
  node_id    TEXT NOT NULL,
  field      TEXT NOT NULL,
  ciphertext BYTEA NOT NULL, -- nonce || aes-256-gcm ciphertext, see vault.Encrypt
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, field)
);`

// Open connects and creates the tables if they're missing (no migration tool for the PoC)
func Open(ctx context.Context, databaseURL string, masterKey []byte) (*Store, error) {
	if len(masterKey) != vault.KeySize {
		return nil, vault.ErrKeySize
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool, key: masterKey}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) SavePipeline(ctx context.Context, id, graphJSON string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO pipelines (id, graph_json) VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET graph_json = EXCLUDED.graph_json, updated_at = now()`, id, graphJSON)
	return err
}

func (s *Store) GetPipeline(ctx context.Context, id string) (string, error) {
	var graph string
	err := s.pool.QueryRow(ctx, `SELECT graph_json FROM pipelines WHERE id = $1`, id).Scan(&graph)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return graph, err
}

// SetSecret encrypts the value and upserts the ciphertext, the plaintext never touches the db
func (s *Store) SetSecret(ctx context.Context, nodeID, field, value string) error {
	blob, err := vault.Encrypt(s.key, []byte(value))
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO secrets (node_id, field, ciphertext) VALUES ($1, $2, $3)
		ON CONFLICT (node_id, field) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`,
		nodeID, field, blob)
	return err
}

// GetSecret decrypts one credential. only the executor calls this, to hand the key to a runner
// for a single node call. there is deliberately no RPC that exposes it.
func (s *Store) GetSecret(ctx context.Context, nodeID, field string) (string, error) {
	var blob []byte
	err := s.pool.QueryRow(ctx, `SELECT ciphertext FROM secrets WHERE node_id = $1 AND field = $2`, nodeID, field).Scan(&blob)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	plain, err := vault.Decrypt(s.key, blob)
	return string(plain), err
}

// ListSecretStatus says which credentials exist, never what they are
func (s *Store) ListSecretStatus(ctx context.Context) ([]SecretRef, error) {
	rows, err := s.pool.Query(ctx, `SELECT node_id, field FROM secrets ORDER BY node_id, field`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecretRef
	for rows.Next() {
		var r SecretRef
		if err := rows.Scan(&r.NodeID, &r.Field); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

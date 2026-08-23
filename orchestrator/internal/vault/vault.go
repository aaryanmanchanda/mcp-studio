package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
)

const (
	KeySize           = 32
	standardNonceSize = 12
)

var (
	ErrKeySize            = errors.New("key size must be 32 bytes")
	ErrCiphertextTooShort = errors.New("ciphertext shorter than nonce")
)

func NonceSize() int {
	return standardNonceSize
}

func Encrypt(key, plaintext []byte) ([]byte, error) {
	if len(key) != KeySize {
		return nil, ErrKeySize
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())

	_, err = io.ReadFull(rand.Reader, nonce) //Read must not proceed with partial nonce
	if err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil

}

func Decrypt(key, blob []byte) ([]byte, error) {
	if len(key) != KeySize {
		return nil, ErrKeySize
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, ErrCiphertextTooShort
	}

	nonce, ciphertext := blob[:gcm.NonceSize()], blob[gcm.NonceSize():]

	return gcm.Open(nil, nonce, ciphertext, nil)
}

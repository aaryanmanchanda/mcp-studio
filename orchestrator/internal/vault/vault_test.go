package vault

import (
	"bytes"
	"errors"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	key := make([]byte, 32) //fixed key for test

	cases := []struct {
		name      string
		plaintext []byte
		// two sub-cases in table: normal string, empty byte slice
	}{
		{"normal string", []byte("secret value")},
		{"empty plaintext", []byte{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ciphertext, err := Encrypt(key, tc.plaintext)
			if err != nil {
				t.Fatalf("Encrypt failed: %v", err)
			}
			got, err := Decrypt(key, ciphertext)
			if err != nil {
				t.Fatalf("Decrypt failed: %v", err)
			}
			if !bytes.Equal(tc.plaintext, got) {
				t.Fatalf("roundtrip mismatch: got %q wanted %q", got, tc.plaintext)
			}
		})
	}
}

func TestKeySizeRejected(t *testing.T) {
	badSizes := []int{0, 16, 24, 33}
	plaintext := []byte("doesn't matter")

	for _, size := range badSizes {
		key := make([]byte, size)
		_, err := Encrypt(key, plaintext)
		if !errors.Is(err, ErrKeySize) {
			t.Fatalf("Encrypt with key size %d: got %v, want ErrKeySize", size, err)
		}
		_, err = Decrypt(key, make([]byte, 20))
		if !errors.Is(err, ErrKeySize) {
			t.Fatalf("Decrypt with key size %d: got %v, want ErrKeySize", size, err)
		}
	}
}

func TestNonceUniqueness(t *testing.T) {
	key := make([]byte, 32)
	plaintext := []byte("same plaintext everytime")
	seen := make(map[string]bool)
	const n = 1000

	for i := 0; i < n; i++ {
		ciphertext, err := Encrypt(key, plaintext)
		if err != nil {
			t.Fatalf("error while encryption. failed at iteration %d, %v", i, err)
		}
		nonce := string(ciphertext[:NonceSize()])
		if seen[nonce] {
			t.Fatalf("Womp Womp! Seen this nonce before. Duplicated at %d", i)
		} else {
			seen[nonce] = true
		}
	}
}

func TestCiphertextsDiffer(t *testing.T) {
	key := make([]byte, 32)
	plaintext := []byte("Same plaintext twice")
	ciphertext1, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encountered error for test cipher 1: %v", err)
	}
	ciphertext2, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encountered error for test cipher 2: %v", err)
	}
	if bytes.Equal(ciphertext1, ciphertext2) {
		t.Fatalf("Whoops! Multiple encryptions generated same cipher.")
	}
}

func TestDecryptWrongKey(t *testing.T) {
	keyA := make([]byte, 32)
	keyB := make([]byte, 32)
	plaintext := []byte("Sample input string")
	keyB[3] = 1 //bit flip so keys are slightly different

	ciphertext, err := Encrypt(keyA, plaintext)
	if err != nil {
		t.Fatalf("Error while encrypting: %v", err)
	}
	got, err := Decrypt(keyB, ciphertext)
	if err == nil {
		t.Fatalf("Aw man! Decryption with wrong key didn't fail.")
	}
	if got != nil {
		t.Fatalf("Decryption with wrong key bypassed immediate failure, got: %q", got)
	}
}

func TestDecryptTooShort(t *testing.T) {
	key := make([]byte, 32)
	shortBlob := make([]byte, 5)

	_, err := Decrypt(key, shortBlob)

	if !errors.Is(err, ErrCiphertextTooShort) {
		t.Fatalf("Decrypt with blob size smaller than key. got: %v, need: ErrCiphertextTooShort", err)
	}
}

func TestDecryptTampered(t *testing.T) {
	key := make([]byte, 32)
	plaintext := []byte("Secret value ooh")

	ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Error while encrypting: %v", err)
	}

	cases := []struct {
		name  string
		index int
	}{
		{"tamper nonce", 0},
		{"tamper cipher", NonceSize()},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tampered := bytes.Clone(ciphertext)
			tampered[tc.index] ^= 0x01 //xor to flip one bit (tampering)
			_, err := Decrypt(key, tampered)
			if err == nil {
				t.Fatalf("Tampered cipher case: %v decrypted w/o error", tc)
			}
		})
	}
}

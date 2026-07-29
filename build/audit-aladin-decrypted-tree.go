//go:build ignore

// Command audit-aladin-decrypted-tree validates a decrypted asset tree against
// an official Aladin catalog, including every path, byte length, and xxHash64.
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/bits"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

const (
	prime64_1 = uint64(11400714785074694791)
	prime64_2 = uint64(14029467366897019727)
	prime64_3 = uint64(1609587929392839161)
	prime64_4 = uint64(9650029242287828579)
	prime64_5 = uint64(2870177450012600261)
)

type catalogEntry struct {
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	ContentSize int64  `json:"contentSize"`
}

type inventoryEntry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type auditResult struct {
	SchemaVersion            int    `json:"schemaVersion"`
	CatalogSHA256            string `json:"catalogSha256"`
	CatalogEntries           int    `json:"catalogEntries"`
	ActualFiles              int    `json:"actualFiles"`
	ExpectedBytes            int64  `json:"expectedBytes"`
	ActualBytes              int64  `json:"actualBytes"`
	ExactXXHash64            int    `json:"exactXxHash64"`
	DecryptedInventorySHA256 string `json:"decryptedInventorySha256"`
	Status                   string `json:"status"`
}

func round(acc, input uint64) uint64 {
	acc += input * prime64_2
	acc = bits.RotateLeft64(acc, 31)
	return acc * prime64_1
}

func mergeRound(acc, value uint64) uint64 {
	value = round(0, value)
	acc ^= value
	return acc*prime64_1 + prime64_4
}

func xxHash64(data []byte) uint64 {
	var hash uint64
	index := 0
	if len(data) >= 32 {
		v1 := prime64_1
		v1 += prime64_2
		v2 := prime64_2
		v3 := uint64(0)
		var v4 uint64
		v4 -= prime64_1
		limit := len(data) - 32
		for index <= limit {
			v1 = round(v1, binary.LittleEndian.Uint64(data[index:]))
			v2 = round(v2, binary.LittleEndian.Uint64(data[index+8:]))
			v3 = round(v3, binary.LittleEndian.Uint64(data[index+16:]))
			v4 = round(v4, binary.LittleEndian.Uint64(data[index+24:]))
			index += 32
		}
		hash = bits.RotateLeft64(v1, 1) +
			bits.RotateLeft64(v2, 7) +
			bits.RotateLeft64(v3, 12) +
			bits.RotateLeft64(v4, 18)
		hash = mergeRound(hash, v1)
		hash = mergeRound(hash, v2)
		hash = mergeRound(hash, v3)
		hash = mergeRound(hash, v4)
	} else {
		hash = prime64_5
	}

	hash += uint64(len(data))
	for index+8 <= len(data) {
		value := round(0, binary.LittleEndian.Uint64(data[index:]))
		hash ^= value
		hash = bits.RotateLeft64(hash, 27)*prime64_1 + prime64_4
		index += 8
	}
	if index+4 <= len(data) {
		hash ^= uint64(binary.LittleEndian.Uint32(data[index:])) * prime64_1
		hash = bits.RotateLeft64(hash, 23)*prime64_2 + prime64_3
		index += 4
	}
	for index < len(data) {
		hash ^= uint64(data[index]) * prime64_5
		hash = bits.RotateLeft64(hash, 11) * prime64_1
		index++
	}
	hash ^= hash >> 33
	hash *= prime64_2
	hash ^= hash >> 29
	hash *= prime64_3
	hash ^= hash >> 32
	return hash
}

func sha256Hex(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func main() {
	if xxHash64(nil) != 0xef46db3751d8e999 ||
		xxHash64([]byte("a")) != 0xd24ec4f1a98c6e5b {
		panic("internal xxHash64 self-test failed")
	}
	catalogPath := flag.String("catalog", "", "Path to a JSON Aladin catalog")
	root := flag.String("root", "", "Decrypted asset tree root")
	outputPath := flag.String("out", "", "Output audit JSON path")
	workers := flag.Int("workers", runtime.NumCPU(), "Concurrent hashing workers")
	flag.Parse()
	if *catalogPath == "" || *root == "" || *outputPath == "" {
		fmt.Fprintln(os.Stderr, "-catalog, -root, and -out are required")
		os.Exit(2)
	}
	if *workers < 1 {
		fmt.Fprintln(os.Stderr, "-workers must be positive")
		os.Exit(2)
	}

	catalogBytes, err := os.ReadFile(*catalogPath)
	if err != nil {
		panic(err)
	}
	var catalog []catalogEntry
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		panic(err)
	}
	sort.Slice(catalog, func(i, j int) bool {
		return catalog[i].Path < catalog[j].Path
	})

	expectedPaths := make(map[string]struct{}, len(catalog))
	var expectedBytes int64
	for _, entry := range catalog {
		if _, duplicate := expectedPaths[entry.Path]; duplicate {
			panic(fmt.Sprintf("duplicate catalog path: %s", entry.Path))
		}
		expectedPaths[entry.Path] = struct{}{}
		expectedBytes += entry.ContentSize
	}

	var actualFiles int
	var actualBytes int64
	err = filepath.WalkDir(*root, func(current string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(*root, current)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if _, exists := expectedPaths[relative]; !exists {
			return fmt.Errorf("unexpected file: %s", relative)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		actualFiles++
		actualBytes += info.Size()
		return nil
	})
	if err != nil {
		panic(err)
	}
	if actualFiles != len(catalog) {
		panic(fmt.Sprintf("file count mismatch: expected %d got %d", len(catalog), actualFiles))
	}
	if actualBytes != expectedBytes {
		panic(fmt.Sprintf("byte count mismatch: expected %d got %d", expectedBytes, actualBytes))
	}

	type job struct {
		index int
		entry catalogEntry
	}
	jobs := make(chan job)
	inventory := make([]inventoryEntry, len(catalog))
	errors := make(chan error, *workers)
	var wait sync.WaitGroup
	for range *workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for item := range jobs {
				filePath := filepath.Join(*root, filepath.FromSlash(item.entry.Path))
				bytes, err := os.ReadFile(filePath)
				if err != nil {
					errors <- err
					continue
				}
				if int64(len(bytes)) != item.entry.ContentSize {
					errors <- fmt.Errorf(
						"size mismatch %s: expected %d got %d",
						item.entry.Path,
						item.entry.ContentSize,
						len(bytes),
					)
					continue
				}
				actualHash := fmt.Sprintf("%016x", xxHash64(bytes))
				if !strings.EqualFold(actualHash, item.entry.ContentHash) {
					errors <- fmt.Errorf(
						"xxHash64 mismatch %s: expected %s got %s",
						item.entry.Path,
						item.entry.ContentHash,
						actualHash,
					)
					continue
				}
				inventory[item.index] = inventoryEntry{
					Path:   item.entry.Path,
					Size:   item.entry.ContentSize,
					SHA256: sha256Hex(bytes),
				}
			}
		}()
	}
	go func() {
		for index, entry := range catalog {
			jobs <- job{index: index, entry: entry}
		}
		close(jobs)
	}()
	wait.Wait()
	close(errors)
	for auditErr := range errors {
		panic(auditErr)
	}

	inventoryBytes, err := json.Marshal(inventory)
	if err != nil {
		panic(err)
	}
	result := auditResult{
		SchemaVersion:            1,
		CatalogSHA256:            sha256Hex(catalogBytes),
		CatalogEntries:           len(catalog),
		ActualFiles:              actualFiles,
		ExpectedBytes:            expectedBytes,
		ActualBytes:              actualBytes,
		ExactXXHash64:            len(inventory),
		DecryptedInventorySHA256: sha256Hex(inventoryBytes),
		Status:                   "exact",
	}
	outputBytes, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(*outputPath, append(outputBytes, '\n'), 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("Aladin decrypted tree audit OK\n")
	fmt.Printf("  files:       %d\n", result.ActualFiles)
	fmt.Printf("  bytes:       %d\n", result.ActualBytes)
	fmt.Printf("  xxHash64:    %d/%d exact\n", result.ExactXXHash64, result.CatalogEntries)
	fmt.Printf("  inventory:   %s\n", result.DecryptedInventorySHA256)
}

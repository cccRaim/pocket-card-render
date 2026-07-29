//go:build ignore

// Command inspect-aladin-index converts an official Aladin asset index into a
// deterministic JSON catalog without logging in or downloading asset blobs.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/na-ji/ptcgp-tools/masterdata_decoder/pkg/aladin"
)

type catalogEntry struct {
	Path           string `json:"path"`
	AddressHash    string `json:"addressHash"`
	ContentHash    string `json:"contentHash"`
	ContentSize    int64  `json:"contentSize"`
	BlobHash       string `json:"blobHash"`
	BlobSize       int64  `json:"blobSize"`
	CryptKeyIDHash string `json:"cryptKeyIdHash"`
	IsCrypted      bool   `json:"isCrypted"`
}

func main() {
	indexPath := flag.String("index", "", "Path to an official .aladin asset index")
	outputPath := flag.String("out", "", "Output JSON path")
	flag.Parse()

	if *indexPath == "" || *outputPath == "" {
		fmt.Fprintln(os.Stderr, "-index and -out are required")
		os.Exit(2)
	}
	indexBytes, err := os.ReadFile(*indexPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read index: %v\n", err)
		os.Exit(1)
	}
	index, err := aladin.ParseSerializedIndex(indexBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse index: %v\n", err)
		os.Exit(1)
	}
	if len(index.AddressValues) != len(index.AddressedBlobs) ||
		len(index.AddressHashes) != len(index.AddressedBlobs) {
		fmt.Fprintf(
			os.Stderr,
			"index arrays differ: paths=%d addressHashes=%d blobs=%d\n",
			len(index.AddressValues),
			len(index.AddressHashes),
			len(index.AddressedBlobs),
		)
		os.Exit(1)
	}

	entries := make([]catalogEntry, len(index.AddressedBlobs))
	for i, blob := range index.AddressedBlobs {
		entries[i] = catalogEntry{
			Path:           index.AddressValues[i],
			AddressHash:    fmt.Sprintf("%016x", index.AddressHashes[i]),
			ContentHash:    fmt.Sprintf("%016x", blob.ContentHash),
			ContentSize:    blob.ContentSize,
			BlobHash:       fmt.Sprintf("%016x", blob.BlobHash),
			BlobSize:       blob.BlobSize,
			CryptKeyIDHash: fmt.Sprintf("%016x", blob.CryptKeyIdHash),
			IsCrypted:      blob.IsCrypted,
		}
	}

	if err := os.MkdirAll(filepath.Dir(*outputPath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "create output directory: %v\n", err)
		os.Exit(1)
	}
	writer, err := os.Create(*outputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create output: %v\n", err)
		os.Exit(1)
	}
	defer writer.Close()
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(entries); err != nil {
		fmt.Fprintf(os.Stderr, "write catalog: %v\n", err)
		os.Exit(1)
	}
}

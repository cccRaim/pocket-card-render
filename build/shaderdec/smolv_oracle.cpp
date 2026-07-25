#include "smolv.h"

#include <cstdint>
#include <iostream>
#include <limits>
#include <vector>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#endif

namespace {

constexpr uint32_t kMaxRecordBytes = 64u * 1024u * 1024u;

bool readExact(void* destination, size_t byteCount) {
    std::cin.read(static_cast<char*>(destination), static_cast<std::streamsize>(byteCount));
    return static_cast<size_t>(std::cin.gcount()) == byteCount;
}

void writeU32(uint32_t value) {
    std::cout.write(reinterpret_cast<const char*>(&value), sizeof(value));
}

void writeResult(uint32_t status, const std::vector<uint8_t>& output) {
    writeU32(status);
    writeU32(static_cast<uint32_t>(output.size()));
    if (!output.empty()) {
        std::cout.write(
            reinterpret_cast<const char*>(output.data()),
            static_cast<std::streamsize>(output.size())
        );
    }
}

}  // namespace

int main() {
#if defined(_WIN32)
    if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1) {
        return 4;
    }
#endif
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    for (;;) {
        uint32_t inputSize = 0;
        std::cin.read(reinterpret_cast<char*>(&inputSize), sizeof(inputSize));
        const std::streamsize headerBytes = std::cin.gcount();
        if (headerBytes == 0 && std::cin.eof()) {
            return 0;
        }
        if (headerBytes != static_cast<std::streamsize>(sizeof(inputSize))) {
            return 2;
        }
        if (inputSize == 0 || inputSize > kMaxRecordBytes) {
            writeResult(1, {});
            continue;
        }

        std::vector<uint8_t> input(inputSize);
        if (!readExact(input.data(), input.size())) {
            return 3;
        }

        const size_t decodedSize = smolv::GetDecodedBufferSize(input.data(), input.size());
        if (decodedSize == 0 || decodedSize > std::numeric_limits<uint32_t>::max()) {
            writeResult(1, {});
            continue;
        }

        std::vector<uint8_t> output(decodedSize);
        if (!smolv::Decode(input.data(), input.size(), output.data(), output.size())) {
            writeResult(1, {});
            continue;
        }
        writeResult(0, output);
    }
}

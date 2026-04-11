#!/usr/bin/env python3
"""
Strip the malformed LC_CODE_SIGNATURE stub from a bun-compiled Mach-O binary
so that `codesign` can re-sign it fresh.

Bun 1.3.x pre-allocates an LC_CODE_SIGNATURE load command pointing to an
uninitialized region at the end of the binary. macOS `codesign` parses the
stub, rejects it as "invalid or unsupported format", and refuses to replace it.

Fix: remove the LC_CODE_SIGNATURE load command entirely and truncate the file
to drop the empty reserved region. codesign --force will then allocate a
brand-new LC_CODE_SIGNATURE of its own.

Usage: strip-bun-sig.py <binary>
"""
import struct
import sys

MH_MAGIC_64 = 0xFEEDFACF
MH_CIGAM_64 = 0xCFFAEDFE
LC_CODE_SIGNATURE = 0x1D
LC_SEGMENT_64 = 0x19

def main(path: str) -> None:
    with open(path, "rb") as f:
        data = bytearray(f.read())

    magic = struct.unpack_from("<I", data, 0)[0]
    if magic != MH_MAGIC_64:
        print(f"ERROR: {path} is not a 64-bit little-endian Mach-O (magic={magic:#x})", file=sys.stderr)
        sys.exit(1)

    # mach_header_64: magic cputype cpusubtype filetype ncmds sizeofcmds flags reserved
    ncmds = struct.unpack_from("<I", data, 16)[0]
    sizeofcmds = struct.unpack_from("<I", data, 20)[0]
    header_end = 32  # sizeof(mach_header_64)

    offset = header_end
    sig_cmd_offset = None
    sig_dataoff = None
    sig_datasize = None
    sig_cmdsize = None
    linkedit_filesize_offset = None  # offset of __LINKEDIT segment's filesize field

    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from("<II", data, offset)
        if cmd == LC_CODE_SIGNATURE:
            sig_cmd_offset = offset
            sig_cmdsize = cmdsize
            sig_dataoff, sig_datasize = struct.unpack_from("<II", data, offset + 8)
        elif cmd == LC_SEGMENT_64:
            segname = bytes(data[offset + 8:offset + 24]).rstrip(b"\x00")
            if segname == b"__LINKEDIT":
                # segment_command_64: cmd cmdsize segname[16] vmaddr vmsize fileoff filesize ...
                # filesize is at offset+48 (uint64)
                linkedit_filesize_offset = offset + 48
        offset += cmdsize

    if sig_cmd_offset is None:
        print("No LC_CODE_SIGNATURE found — nothing to strip.")
        return

    print(f"Found LC_CODE_SIGNATURE at load-cmd offset {sig_cmd_offset}")
    print(f"  dataoff={sig_dataoff} datasize={sig_datasize} cmdsize={sig_cmdsize}")

    # Remove the load command by shifting later commands down and zeroing the tail.
    cmds_region_start = header_end
    cmds_region_end = header_end + sizeofcmds
    tail_start = sig_cmd_offset + sig_cmdsize
    tail_len = cmds_region_end - tail_start
    # Shift tail commands left over the removed command.
    data[sig_cmd_offset:sig_cmd_offset + tail_len] = data[tail_start:tail_start + tail_len]
    # Zero the now-unused bytes at the end of the load-command region.
    data[cmds_region_end - sig_cmdsize:cmds_region_end] = b"\x00" * sig_cmdsize

    # Update header: ncmds--, sizeofcmds -= sig_cmdsize.
    struct.pack_into("<I", data, 16, ncmds - 1)
    struct.pack_into("<I", data, 20, sizeofcmds - sig_cmdsize)

    # Shrink __LINKEDIT's filesize so it no longer covers the truncated sig region.
    if linkedit_filesize_offset is not None:
        old_filesize = struct.unpack_from("<Q", data, linkedit_filesize_offset)[0]
        new_filesize = old_filesize - sig_datasize
        struct.pack_into("<Q", data, linkedit_filesize_offset, new_filesize)
        print(f"Updated __LINKEDIT filesize: {old_filesize} → {new_filesize}")

    # Truncate the file to drop the empty signature region at the end.
    new_size = sig_dataoff
    data = data[:new_size]

    with open(path, "wb") as f:
        f.write(data)

    print(f"Stripped LC_CODE_SIGNATURE. New size: {new_size} bytes.")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1])

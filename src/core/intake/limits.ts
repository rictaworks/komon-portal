/** Limits of intake (instructions.md 1.6.2). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 200;
export const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;
/** Cap for one XML entry read out of a ZIP. */
export const MAX_ZIP_XML_BYTES = 2 * 1024 * 1024;
/** Bytes inspected when deciding whether a file is plain text. */
export const TEXT_SNIFF_BYTES = 8192;
/** Cap for all XML entries of one ZIP together, measured on the real inflated bytes. */
export const MAX_ZIP_XML_TOTAL_BYTES = 8 * 1024 * 1024;
/** Compressed bytes fed to the inflater per step, so that output is checked before it can grow large. */
export const INFLATE_SLICE_BYTES = 2048;
/** Longest accepted arrival number pattern. */
export const MAX_ARRIVAL_PATTERN_LENGTH = 100;

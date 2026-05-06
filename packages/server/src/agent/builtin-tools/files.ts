import type { BuiltinTool } from "./types";

const READ_FILE_CAP_BYTES = 5 * 1024 * 1024;
const WRITE_FILE_CAP_BYTES = 5 * 1024 * 1024;
const VIEW_IMAGE_CAP_BYTES = 5 * 1024 * 1024;

// Sentinel the Ollama loop unpacks into the next user message's `images` field.
// Format: `__OC_IMAGE_B64__:<mime>:<base64>`. Plain string keeps the executor
// signature stable; the chat loop is the only consumer that splits this apart.
export const VIEW_IMAGE_SENTINEL = "__OC_IMAGE_B64__:";

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

type PathResolver = (p: string) => string;

export function buildFileTools(resolveIn: PathResolver): Record<string, BuiltinTool> {
  return {
    read_file: {
      tool: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file. Path is resolved against the agent's working directory. Files larger than 5MB are rejected.",
          parameters: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", description: "Absolute or relative file path" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const path = typeof args.path === "string" ? args.path : "";
          if (!path) return "Error: path must be a non-empty string.";
          const file = Bun.file(resolveIn(path));
          if (!(await file.exists())) return `Error: file not found: ${path}`;
          if (file.size > READ_FILE_CAP_BYTES) {
            return `Error: file exceeds ${READ_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${file.size} bytes). Use grep or a smaller range.`;
          }
          return await file.text();
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    write_file: {
      tool: {
        type: "function",
        function: {
          name: "write_file",
          description: "Write content to a file. Path is resolved against the agent's working directory.",
          parameters: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string", description: "File path, relative to cwd or absolute" },
              content: { type: "string", description: "Content to write" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const path = typeof args.path === "string" ? args.path : "";
          if (!path) return "Error: path must be a non-empty string.";
          const content = typeof args.content === "string" ? args.content : "";
          const byteLen = Buffer.byteLength(content, "utf-8");
          if (byteLen > WRITE_FILE_CAP_BYTES) {
            return `Error: content exceeds ${WRITE_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${byteLen} bytes).`;
          }
          await Bun.write(resolveIn(path), content);
          return `File written: ${path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    edit: {
      tool: {
        type: "function",
        function: {
          name: "edit",
          description:
            "Edit a file by replacing an exact string with a new one. old_string must match exactly — whitespace, newlines, indentation all count. If old_string appears multiple times, set replace_all to true or add more surrounding context to make it unique. Path is resolved against the agent's working directory.",
          parameters: {
            type: "object",
            required: ["path", "old_string", "new_string"],
            properties: {
              path: { type: "string", description: "File path, relative to cwd or absolute" },
              old_string: {
                type: "string",
                description: "Exact text to find. Whitespace and newlines must match.",
              },
              new_string: { type: "string", description: "Replacement text." },
              replace_all: {
                type: "boolean",
                description:
                  "Replace every occurrence (default false — one unique match required).",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const path = typeof args.path === "string" ? args.path : "";
          if (!path) return "Error: path must be a non-empty string.";
          const filePath = resolveIn(path);
          const oldStr = typeof args.old_string === "string" ? args.old_string : "";
          const newStr = typeof args.new_string === "string" ? args.new_string : "";
          const replaceAll = args.replace_all === true;

          // An empty old_string matches every zero-width gap between characters.
          // `"abc".split("").join("X")` → "XaXbXcX" — destroys the file silently.
          // `"abc".includes("")` is also always true, so the "not found" guard
          // below wouldn't catch it. Reject explicitly.
          if (oldStr.length === 0) {
            return "Error: old_string must not be empty.";
          }

          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return `Error: file not found: ${path}`;
          }
          if (file.size > READ_FILE_CAP_BYTES) {
            return `Error: file exceeds ${READ_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${file.size} bytes). Use bash + sed/awk for large files.`;
          }
          const content = await file.text();
          if (!content.includes(oldStr)) {
            return `Error: old_string not found. Make sure whitespace and newlines match exactly.`;
          }

          let updated: string;
          if (replaceAll) {
            updated = content.split(oldStr).join(newStr);
          } else {
            const firstIdx = content.indexOf(oldStr);
            const secondIdx = content.indexOf(oldStr, firstIdx + oldStr.length);
            if (secondIdx !== -1) {
              return `Error: old_string matches multiple times. Add more surrounding context to make it unique, or set replace_all: true.`;
            }
            updated = content.slice(0, firstIdx) + newStr + content.slice(firstIdx + oldStr.length);
          }

          const updatedBytes = Buffer.byteLength(updated, "utf8");
          if (updatedBytes > WRITE_FILE_CAP_BYTES) {
            return `Error: edited content would exceed ${WRITE_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${updatedBytes} bytes).`;
          }
          await Bun.write(filePath, updated);
          return `File edited: ${path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    view_image: {
      tool: {
        type: "function",
        function: {
          name: "view_image",
          description:
            "Load an image file (PNG, JPEG, WEBP, GIF) so the model can see it. Use this to inspect screenshots, photos, or any visual content. Path is resolved against the agent's working directory. Files larger than 5MB are rejected. Only effective with vision-capable models (e.g. gemma3, gemma4, llava, qwen-vl).",
          parameters: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", description: "Absolute or relative path to an image file" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const path = typeof args.path === "string" ? args.path : "";
          if (!path) return "Error: path must be a non-empty string.";
          const ext = path.toLowerCase().split(".").pop() ?? "";
          const mime = IMAGE_EXTENSIONS[ext];
          if (!mime) {
            return `Error: unsupported image extension ".${ext}". Supported: ${Object.keys(IMAGE_EXTENSIONS).join(", ")}.`;
          }
          const file = Bun.file(resolveIn(path));
          if (!(await file.exists())) return `Error: file not found: ${path}`;
          if (file.size > VIEW_IMAGE_CAP_BYTES) {
            return `Error: image exceeds ${VIEW_IMAGE_CAP_BYTES / (1024 * 1024)}MB cap (${file.size} bytes).`;
          }
          const buf = await file.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          return `${VIEW_IMAGE_SENTINEL}${mime}:${b64}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

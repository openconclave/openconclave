import type { BuiltinTool } from "./types";

const READ_FILE_CAP_BYTES = 5 * 1024 * 1024;
const WRITE_FILE_CAP_BYTES = 5 * 1024 * 1024;

type PathResolver = (p: string) => string;

export function buildFileTools(resolveIn: PathResolver): Record<string, BuiltinTool> {
  return {
    read_file: {
      tool: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file",
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
          const file = Bun.file(resolveIn(args.path as string));
          if (!(await file.exists())) return `Error: file not found: ${args.path}`;
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
          const content = args.content as string;
          const byteLen = Buffer.byteLength(content, "utf-8");
          if (byteLen > WRITE_FILE_CAP_BYTES) {
            return `Error: content exceeds ${WRITE_FILE_CAP_BYTES / (1024 * 1024)}MB cap (${byteLen} bytes).`;
          }
          await Bun.write(resolveIn(args.path as string), content);
          return `File written: ${args.path}`;
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
          const filePath = resolveIn(args.path as string);
          const oldStr = args.old_string as string;
          const newStr = args.new_string as string;
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
            return `Error: file not found: ${args.path}`;
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

          await Bun.write(filePath, updated);
          return `File edited: ${args.path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

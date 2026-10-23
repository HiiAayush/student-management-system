import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_API_URL = "https://student-management-frontend2.onrender.com";

// Read STUDENT_API_URL from the Claude Desktop config; fall back to the default.
const API_BASE_URL = (
  process.env.STUDENT_API_URL?.trim() || DEFAULT_API_URL
).replace(/\/+$/, "");

console.error("[student-management] Using API:", API_BASE_URL);

const REQUEST_TIMEOUT_MS = 15_000; // per HTTP attempt
const TOTAL_BUDGET_MS = 50_000; // stay under Claude Desktop's ~60s tool limit
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function describeFetchError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return `no response within ${REQUEST_TIMEOUT_MS / 1000}s`;
  }
  const code = error?.cause?.code || error?.code;
  return code ? `${error.message} (${code})` : String(error?.message || error);
}

// 15-second timeout per attempt.
// GET requests are retried on timeouts/network errors (safe to repeat).
// Other methods are retried only on 502/503/504, to avoid duplicate writes.
async function fetchWithRetry(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const started = Date.now();
  let lastProblem = "unknown error";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 2000) break;
    attempts = attempt;

    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      });

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        lastProblem = `HTTP ${response.status}`;
        console.error(
          `[student-management] ${method} ${url} attempt ${attempt}: ${lastProblem}, retrying`
        );
        await sleep(2000);
        continue;
      }

      return response;
    } catch (error) {
      lastProblem = describeFetchError(error);
      console.error(
        `[student-management] ${method} ${url} attempt ${attempt} failed: ${lastProblem}`
      );

      if (!isGet) {
        throw new Error(
          `${method} ${url} failed: ${lastProblem}. The request may or may not ` +
            `have been processed. Check with list_students before retrying.`
        );
      }
      await sleep(1000);
    }
  }

  throw new Error(
    `${method} ${url} failed after ${attempts} attempt(s): ${lastProblem}. ` +
      `If the backend was idle, Render may be cold-starting. Wait about a minute and try again.`
  );
}

// Make API requests and return parsed JSON.
async function apiRequest(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = `${API_BASE_URL}${path}`;

  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  let result;
  let isJson = true;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    isJson = false;
    result = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `${method} ${path} returned HTTP ${response.status}: ${
        result.message || text.slice(0, 300) || "Request failed"
      }`
    );
  }

  if (!isJson) {
    throw new Error(
      `${method} ${path} returned HTTP ${response.status} but the body was not JSON ` +
        `(starts with: ${text.slice(0, 120)}). ` +
        `${API_BASE_URL} may be serving a web page instead of the API.`
    );
  }

  return result;
}

function successResult(message, data) {
  return {
    content: [
      {
        type: "text",
        text: `${message}\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}

function errorResult(error) {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${error.message}`,
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server and tools
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "student-management",
  version: "1.2.0",
});

// 1. Check API and database health.
server.tool(
  "check_student_api",
  "Check whether the Student Management API and database are available.",
  {},
  async () => {
    const url = `${API_BASE_URL}/health`;

    try {
      const response = await fetchWithRetry(url);
      const body = await response.text();

      console.error("[student-management] Health status:", response.status);

      return {
        content: [
          {
            type: "text",
            text: `URL: ${url}\nHTTP ${response.status}\n${body}`,
          },
        ],
        isError: !response.ok,
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 2. List students, optionally filtering by student ID, name,
// email, or department.
server.tool(
  "list_students",
  "List student records. Optionally search by student ID, name, email, or department.",
  {
    query: z
      .string()
      .optional()
      .describe(
        "Optional search text, such as a student's name, student ID, email, or department."
      ),
  },
  async ({ query }) => {
    try {
      const params = new URLSearchParams();

      if (query?.trim()) {
        params.set("q", query.trim());
      }

      const suffix = params.toString() ? `?${params.toString()}` : "";
      const result = await apiRequest(`/api/students${suffix}`);

      return successResult("Student records retrieved successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 3. Get one student using the MongoDB document _id.
server.tool(
  "get_student",
  "Get a single student using the MongoDB document ID (_id), not the studentId field.",
  {
    id: z
      .string()
      .min(1)
      .describe("The student's MongoDB _id returned by list_students."),
  },
  async ({ id }) => {
    try {
      const result = await apiRequest(`/api/students/${encodeURIComponent(id)}`);

      return successResult("Student record retrieved successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 4. Add a student.
server.tool(
  "add_student",
  "Add a student to the Student Management System. Required fields: studentId, name, email, department, and semester. Contact is optional.",
  {
    studentId: z.string().trim().min(1).describe("Unique student identifier."),
    name: z.string().trim().min(1).describe("Student's full name."),
    email: z.string().trim().email().describe("Student's email address."),
    department: z.string().trim().min(1).describe("Student's department."),
    semester: z
      .number()
      .int()
      .min(1)
      .max(12)
      .describe("Semester number, a whole number from 1 to 12."),
    contact: z.string().optional().describe("Optional contact number."),
  },
  async (student) => {
    try {
      const result = await apiRequest("/api/students", {
        method: "POST",
        body: JSON.stringify(student),
      });

      return successResult("Student added successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 5. Update a student. All fields except id are optional.
server.tool(
  "update_student",
  "Update an existing student using the MongoDB document ID (_id). Supply only the fields that need to change.",
  {
    id: z
      .string()
      .min(1)
      .describe("The student's MongoDB _id returned by list_students."),
    studentId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    department: z.string().trim().min(1).optional(),
    semester: z.number().int().min(1).max(12).optional(),
    contact: z.string().optional(),
  },
  async ({ id, ...changes }) => {
    try {
      const updates = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(updates).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No changes provided. Specify at least one field to update.",
            },
          ],
          isError: true,
        };
      }

      const result = await apiRequest(`/api/students/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });

      return successResult("Student updated successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 6. Delete a student. Explicit confirmation is mandatory.
server.tool(
  "delete_student",
  "Permanently delete a student using the MongoDB document ID (_id). Ask the user for explicit confirmation before calling this tool and set confirm to true only after confirmation.",
  {
    id: z
      .string()
      .min(1)
      .describe("The student's MongoDB _id returned by list_students."),
    confirm: z
      .boolean()
      .describe(
        "Must be true only after the user explicitly confirms this deletion."
      ),
  },
  async ({ id, confirm }) => {
    if (confirm !== true) {
      return {
        content: [
          {
            type: "text",
            text: "Deletion cancelled. Explicit user confirmation is required.",
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await apiRequest(`/api/students/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      return successResult("Student deleted successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Wake the backend (Render free tier sleeps when idle) without blocking startup.
fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(90_000) })
  .then((r) => console.error("[student-management] Warm-up status:", r.status))
  .catch((e) =>
    console.error("[student-management] Warm-up failed:", describeFetchError(e))
  );

const transport = new StdioServerTransport();
await server.connect(transport);

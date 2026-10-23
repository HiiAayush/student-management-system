
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE_URL = (
  process.env.STUDENT_API_URL ||
  "https://student-management-frontend2.onrender.com"
).replace(/\/+$/, "");

const server = new McpServer({
  name: "student-management",
  version: "1.2.0",
});

const REQUEST_TIMEOUT_MS = 15000;

// Helper: make API requests and return readable results.
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  let result;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `API returned HTTP ${response.status}: ${
        result.message || text || "Request failed"
      }`
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
  const message =
    error?.name === "TimeoutError" || error?.name === "AbortError"
      ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check whether the backend is awake and reachable.`
      : error?.message || String(error);

  console.error("[student-management] API error:", message);

  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}

// 1. Check API and database health.
server.tool(
  "check_student_api",
  "Check whether the Student Management API and database are available.",
  {},
  async () => {
    const url = `${API_BASE_URL}/health`;

    try {
      console.error("[student-management] Health URL:", url);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const result = await response.text();

      console.error(
        "[student-management] Health status:",
        response.status
      );
      console.error(
        "[student-management] Health response:",
        result
      );

      return {
        content: [
          {
            type: "text",
            text: `URL: ${url}\nHTTP ${response.status}\n${result}`,
          },
        ],
        isError: !response.ok,
      };
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 2. List students, optionally filtering by ID, name, email, or department.
server.tool(
  "list_students",
  "List student records. Optionally search by student ID, name, email, or department.",
  {
    query: z.string().optional().describe(
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
    id: z.string().min(1).describe(
      "The student's MongoDB _id returned by list_students."
    ),
  },
  async ({ id }) => {
    try {
      const result = await apiRequest(
        `/api/students/${encodeURIComponent(id)}`
      );

      return successResult("Student record retrieved successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 4. Add a student.
server.tool(
  "add_student",
  "Add a student. Required fields: studentId, name, email, department, semester. Contact is optional.",
  {
    studentId: z.string().trim().min(1).describe("Unique student identifier."),
    name: z.string().trim().min(1).describe("Student's full name."),
    email: z.string().trim().email().describe("Student's email address."),
    department: z.string().trim().min(1).describe("Student's department."),
    semester: z.number().int().min(1).max(12).describe(
      "Semester number, a whole number from 1 to 12."
    ),
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

// 5. Update a student using MongoDB document _id.
server.tool(
  "update_student",
  "Update an existing student using MongoDB document ID (_id). Supply only the fields to change.",
  {
    id: z.string().min(1).describe(
      "The student's MongoDB _id returned by list_students."
    ),
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

      const result = await apiRequest(
        `/api/students/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: JSON.stringify(updates),
        }
      );

      return successResult("Student updated successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// 6. Delete a student. Explicit confirmation is mandatory.
server.tool(
  "delete_student",
  "Permanently delete a student using MongoDB document ID (_id). Obtain explicit user confirmation before setting confirm to true.",
  {
    id: z.string().min(1).describe(
      "The student's MongoDB _id returned by list_students."
    ),
    confirm: z.boolean().describe(
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
      const result = await apiRequest(
        `/api/students/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        }
      );

      return successResult("Student deleted successfully.", result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// Start the MCP server using standard input/output.
const transport = new StdioServerTransport();
await server.connect(transport);

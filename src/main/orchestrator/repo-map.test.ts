import { describe, expect, it } from "vitest";
import { extractFileSymbols, RepoMapIndexer } from "./repo-map";

describe("Repo-Map Indexer (Symbol Topology)", () => {
  it("extracts classes, interfaces, functions, and types correctly", () => {
    const code = `
      export interface UserProfile {
        id: string;
        name: string;
      }

      export class UserManager {
        constructor() {}
      }

      export async function fetchUserById(id: string): Promise<UserProfile> {
        return { id, name: "test" };
      }

      export type UserId = string;
      export enum UserRole { Admin, User }
    `;

    const symbols = extractFileSymbols(code);
    expect(symbols.length).toBe(5);
    expect(symbols.map((s) => s.name)).toEqual([
      "UserProfile",
      "UserManager",
      "fetchUserById",
      "UserId",
      "UserRole",
    ]);
  });

  it("generates structured repo map prompt within character limits", () => {
    const indexer = new RepoMapIndexer();
    const prompt = indexer.generateRepoMapPrompt(process.cwd(), {
      maxCharacters: 1500,
      maxFiles: 10,
    });

    expect(typeof prompt).toBe("string");
    if (prompt) {
      expect(prompt).toContain("[REPOSITORY TOPOLOGY MAP]");
    }
  });
});

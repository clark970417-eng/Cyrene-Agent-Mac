import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { writeJsonAtomic } from "../fs-atomic";

export interface UserProfile {
  nickname: string;
  callPreference: string;
  birthday: string;
  timezone: string;
  avatarPath: string;
  defaultCity: string;
}

const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: "",
  callPreference: "",
  birthday: "",
  timezone: "Asia/Taipei",
  avatarPath: "",
  defaultCity: "",
};

export function getUserProfilePath(): string {
  return path.join(app.getPath("userData"), "user-profile.json");
}

export function loadUserProfile(): UserProfile {
  try {
    const filePath = getUserProfilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_USER_PROFILE;
    const raw = fs.readFileSync(filePath, "utf8");
    return { ...DEFAULT_USER_PROFILE, ...(JSON.parse(raw) as Partial<UserProfile>) };
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export function saveUserProfile(profile: Partial<UserProfile>): UserProfile {
  const existing = loadUserProfile();
  const merged = { ...existing, ...profile };
  const filePath = getUserProfilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, merged);
  return merged;
}

export function getDefaultCity(): string {
  try {
    return loadUserProfile().defaultCity || "";
  } catch {
    return "";
  }
}

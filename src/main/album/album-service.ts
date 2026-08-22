// Visual Memory Album Service -- 管理 Cyrene 回憶相簿與拍立得照片

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AlbumData, CreatePhotoPayload, MemoryPhoto } from "../../shared/album-types";

export class AlbumService {
  private filePath: string;
  private data: AlbumData = {
    photos: [],
    updatedAt: Date.now(),
  };
  private initialized = false;

  constructor(storageDir?: string) {
    this.filePath = path.join(storageDir || process.cwd(), "memory-album.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      this.data = JSON.parse(raw) as AlbumData;
    } catch {
      this.data = {
        photos: [],
        updatedAt: Date.now(),
      };
    }
    this.initialized = true;
  }

  async getPhotos(): Promise<MemoryPhoto[]> {
    await this.initialize();
    return [...this.data.photos].sort((a, b) => b.timestamp - a.timestamp);
  }

  async addPhoto(payload: CreatePhotoPayload): Promise<MemoryPhoto> {
    await this.initialize();
    const now = Date.now();
    const dateStr = new Date(now).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const photo: MemoryPhoto = {
      id: randomUUID(),
      title: payload.title,
      description: payload.description,
      prompt: payload.prompt,
      imageUrl: payload.imageUrl || "",
      dateStr,
      timestamp: now,
      tags: payload.tags ?? ["生活日常"],
      mood: payload.mood ?? "開心",
      isFavorite: false,
    };

    this.data.photos.unshift(photo);
    this.data.updatedAt = now;
    await this.persist();
    return photo;
  }

  async deletePhoto(photoId: string): Promise<boolean> {
    await this.initialize();
    const initialLen = this.data.photos.length;
    this.data.photos = this.data.photos.filter((p) => p.id !== photoId);
    if (this.data.photos.length !== initialLen) {
      this.data.updatedAt = Date.now();
      await this.persist();
      return true;
    }
    return false;
  }

  async toggleFavorite(photoId: string): Promise<MemoryPhoto | null> {
    await this.initialize();
    const photo = this.data.photos.find((p) => p.id === photoId);
    if (photo) {
      photo.isFavorite = !photo.isFavorite;
      this.data.updatedAt = Date.now();
      await this.persist();
      return photo;
    }
    return null;
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AlbumService] Persist failed:", err);
    }
  }
}

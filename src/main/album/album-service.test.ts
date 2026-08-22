import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AlbumService } from "./album-service";

describe("AlbumService", () => {
  let tmpDir: string;
  let service: AlbumService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cy-album-test-"));
    service = new AlbumService(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("adds and retrieves memory photos", async () => {
    const photosInitial = await service.getPhotos();
    expect(photosInitial).toEqual([]);

    const photo = await service.addPhoto({
      title: "第一次一起寫程式",
      description: "今天完成了很棒的模組！",
      imageUrl: "data:image/png;base64,sample",
      tags: ["紀念", "工作"],
      mood: "興奮",
    });

    expect(photo.id).toBeDefined();
    expect(photo.title).toBe("第一次一起寫程式");
    expect(photo.isFavorite).toBe(false);

    const photosAfter = await service.getPhotos();
    expect(photosAfter.length).toBe(1);
    expect(photosAfter[0].id).toBe(photo.id);
  });

  it("toggles favorite status", async () => {
    const photo = await service.addPhoto({
      title: "星空下散步",
      description: "美麗的夜景",
      tags: ["約會"],
    });

    const toggled = await service.toggleFavorite(photo.id);
    expect(toggled?.isFavorite).toBe(true);

    const toggledAgain = await service.toggleFavorite(photo.id);
    expect(toggledAgain?.isFavorite).toBe(false);
  });

  it("deletes photo", async () => {
    const photo = await service.addPhoto({
      title: "待刪除相片",
      description: "測試刪除",
    });

    const deleted = await service.deletePhoto(photo.id);
    expect(deleted).toBe(true);

    const photos = await service.getPhotos();
    expect(photos.length).toBe(0);
  });
});

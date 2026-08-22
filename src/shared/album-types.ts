// Memory Album (回憶手帳與拍立得相簿) 共享型別定義

export interface MemoryPhoto {
  id: string;
  title: string;
  description: string;
  prompt?: string;
  imageUrl: string; // 支援 local file:// 路徑或 data:image URL
  dateStr: string;
  timestamp: number;
  tags: string[];
  mood?: string;
  isFavorite?: boolean;
}

export interface AlbumData {
  photos: MemoryPhoto[];
  updatedAt: number;
}

export interface CreatePhotoPayload {
  title: string;
  description: string;
  prompt?: string;
  imageUrl?: string;
  tags?: string[];
  mood?: string;
}

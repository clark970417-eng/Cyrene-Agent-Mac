import React, { useEffect, useState } from "react";
import type { MemoryPhoto } from "../../../../shared/album-types";
import "./MemoryAlbumModal.css";

export interface MemoryAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MemoryAlbumModal({ isOpen, onClose }: MemoryAlbumModalProps) {
  const [photos, setPhotos] = useState<MemoryPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterFav, setFilterFav] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newMood, setNewMood] = useState("開心 ✨");
  const [newTags, setNewTags] = useState("生活日常, 紀念");
  const [newImageUrl, setNewImageUrl] = useState("");

  const refreshPhotos = async () => {
    if (!window.album) return;
    setLoading(true);
    try {
      const list = await window.album.getPhotos();
      setPhotos(list);
    } catch (err) {
      console.error("載入相簿失敗:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshPhotos();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleFavorite = async (photoId: string) => {
    if (!window.album) return;
    const updated = await window.album.toggleFavorite(photoId);
    if (updated) {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? updated : p)));
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!window.album) return;
    if (window.confirm("確定要刪除這張拍立得回憶嗎？")) {
      const ok = await window.album.deletePhoto(photoId);
      if (ok) {
        setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      }
    }
  };

  const handleCreatePhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.album || !newTitle.trim()) return;
    try {
      const created = await window.album.addPhoto({
        title: newTitle.trim(),
        description: newDesc.trim(),
        mood: newMood,
        tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
        imageUrl: newImageUrl.trim(),
      });
      setPhotos((prev) => [created, ...prev]);
      setShowAddForm(false);
      setNewTitle("");
      setNewDesc("");
      setNewImageUrl("");
    } catch (err) {
      console.error("新增相片失敗:", err);
    }
  };

  const displayedPhotos = filterFav ? photos.filter((p) => p.isFavorite) : photos;

  return (
    <div className="cy-album-overlay" onClick={onClose}>
      <div className="cy-album-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cy-album-header">
          <div className="cy-album-title-group">
            <h2 className="cy-album-title">📸 昔漣的時光回憶手帳</h2>
            <span className="cy-album-subtitle">珍藏我們一起度過的每一個時刻</span>
          </div>
          <div className="cy-album-header-actions">
            <button
              className={`cy-album-filter-btn ${filterFav ? "is-active" : ""}`}
              onClick={() => setFilterFav((prev) => !prev)}
            >
              {filterFav ? "★ 只看珍藏" : "☆ 顯示全部"}
            </button>
            <button className="cy-album-add-btn" onClick={() => setShowAddForm((prev) => !prev)}>
              + 記錄新時刻
            </button>
            <button className="cy-album-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {showAddForm && (
          <form className="cy-album-form" onSubmit={handleCreatePhoto}>
            <h3>✨ 留下一張新的拍立得回憶</h3>
            <div className="cy-album-form-grid">
              <input
                type="text"
                placeholder="回憶標題 (例: 第一次專注完成了專案重構)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="心情標籤 (例: 欣慰、元氣、充實)"
                value={newMood}
                onChange={(e) => setNewMood(e.target.value)}
              />
              <input
                type="text"
                placeholder="標籤，逗號分隔 (例: 工作, 專注, 昔漣)"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />
              <input
                type="text"
                placeholder="圖片網址或留空 (可填寫圖片路徑)"
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
              />
            </div>
            <textarea
              placeholder="寫下這份回憶的小細節或當時的想法..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
            />
            <div className="cy-album-form-buttons">
              <button type="button" className="cy-album-btn-ghost" onClick={() => setShowAddForm(false)}>
                取消
              </button>
              <button type="submit" className="cy-album-btn-submit">
                保存回憶
              </button>
            </div>
          </form>
        )}

        <div className="cy-album-gallery">
          {loading && <div className="cy-album-empty">載入中...</div>}
          {!loading && displayedPhotos.length === 0 && (
            <div className="cy-album-empty">
              <p>📭 目前還沒有記錄照片哦！</p>
              <p className="cy-album-empty-hint">點擊上方「+ 記錄新時刻」建立第一張回憶吧~</p>
            </div>
          )}
          {!loading &&
            displayedPhotos.map((photo) => (
              <div className="cy-polaroid-card" key={photo.id}>
                <div className="cy-polaroid-photo-frame">
                  {photo.imageUrl ? (
                    <img src={photo.imageUrl} alt={photo.title} className="cy-polaroid-img" />
                  ) : (
                    <div className="cy-polaroid-placeholder">
                      <span className="cy-polaroid-camera-icon">📷</span>
                      <span className="cy-polaroid-mood-badge">{photo.mood}</span>
                    </div>
                  )}
                  <button
                    className={`cy-polaroid-fav-btn ${photo.isFavorite ? "is-fav" : ""}`}
                    onClick={() => handleToggleFavorite(photo.id)}
                    title="收藏"
                  >
                    ★
                  </button>
                </div>
                <div className="cy-polaroid-caption">
                  <div className="cy-polaroid-title">{photo.title}</div>
                  {photo.description && <p className="cy-polaroid-desc">{photo.description}</p>}
                  <div className="cy-polaroid-meta">
                    <span className="cy-polaroid-date">{photo.dateStr}</span>
                    <button
                      className="cy-polaroid-delete-btn"
                      onClick={() => handleDelete(photo.id)}
                      title="刪除"
                    >
                      🗑
                    </button>
                  </div>
                  {photo.tags && photo.tags.length > 0 && (
                    <div className="cy-polaroid-tags">
                      {photo.tags.map((tag, idx) => (
                        <span key={idx} className="cy-polaroid-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

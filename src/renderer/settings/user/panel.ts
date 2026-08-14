// User 面板业务逻辑：用户资料加载 / 保存 / 头像上传 / 性别选择
// 从 settings.ts 抽离。依赖 user DOM 引用（./dom）、timezone-options（白名单 + 校验）。
// 副作用导入：模块加载时执行事件绑定 + 初始加载。

import {
  avatarEl, uploadAvatarBtn,
  userDefaultCityInput, userNicknameInput, userCallPrefInput,
  userBirthdayInput,
} from "./dom";

const avatarPlaceholder = avatarEl?.querySelector("span") as HTMLElement | null;

function showAvatar(dataUrl: string | null): void {
  if (!dataUrl || !avatarEl) return;
  if (!avatarEl) return;
  let img = avatarEl.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.borderRadius = "50%";
    img.style.objectFit = "cover";
    avatarEl.appendChild(img);
  }
  img.src = dataUrl;
  if (avatarPlaceholder) avatarPlaceholder.style.display = "none";
}

async function loadUserProfile(): Promise<void> {
  try {
    const avatarDataUrl = await window.user?.getAvatar();
    if (avatarDataUrl) showAvatar(avatarDataUrl);
    if (uploadAvatarBtn) uploadAvatarBtn.disabled = false;
    // 加载用户字段（昵称/称呼偏好/生日/默认城市）
    const profile = await window.user?.getProfile();
    if (profile) {
      if (userNicknameInput) userNicknameInput.value = String(profile.nickname ?? "");
      if (userCallPrefInput) userCallPrefInput.value = String(profile.callPreference ?? "");
      if (userBirthdayInput) userBirthdayInput.value = String(profile.birthday ?? "");
      if (userDefaultCityInput) userDefaultCityInput.value = String(profile.defaultCity ?? "");
    }
  } catch {
    console.warn("[settings] load user profile failed");
  }
}

// 用户字段：失焦/回车保存（每个字段独立原子保存）
function bindUserProfileSave(input: HTMLInputElement | null, field: string): void {
  if (!input) return;
  const save = (): void => {
    void window.user?.saveProfile({ [field]: input.value.trim() });
  };
  input.addEventListener("change", save);
  input.addEventListener("blur", save);
}

// ===== 事件绑定（模块加载时执行） =====
bindUserProfileSave(userNicknameInput, "nickname");
bindUserProfileSave(userCallPrefInput, "callPreference");
bindUserProfileSave(userBirthdayInput, "birthday");
// 默认城市复用上面的 saveCity（保持原逻辑）
if (userDefaultCityInput) {
  const saveCity = (): void => {
    const value = userDefaultCityInput.value.trim();
    void window.user?.saveProfile({ defaultCity: value });
  };
  userDefaultCityInput.addEventListener("change", saveCity);
  userDefaultCityInput.addEventListener("blur", saveCity);
}

if (uploadAvatarBtn) {
  uploadAvatarBtn.addEventListener("click", async () => {
    try {
      const result = await window.user?.uploadAvatar();
      if (result?.avatarPath) {
        const avatarDataUrl = await window.user?.getAvatar();
        if (avatarDataUrl) showAvatar(avatarDataUrl);
      }
    } catch (err) {
      console.error("[settings] upload avatar failed", err);
    }
  });
}

// 模块加载时拉一次配置
void loadUserProfile();

// Discord 音樂子系統：按鈕/選單互動、收藏/播放清單管理、音樂控制器訊息維護
// 從 DiscordAdapter 抽離（Phase: split music orchestration out of the 3300-line god-class）。
// 依賴以顯式建構子注入，不持有回指 DiscordAdapter 的引用，仿照同目錄 DiscordVoiceCall 的模式。

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { DiscordVoiceCall, DiscordMusicState } from "./voice-call";
import {
  copyableDiscordMusicUrl,
  findDiscordMusicUrl,
  resolveDiscordMusicTracks,
  type DiscordMusicTrack,
} from "./music-source";
import {
  buildDiscordMusicPlayer,
  buildDiscordMusicQueue,
  buildDiscordMusicHistory,
  buildDiscordMusicPlaylists,
  DISCORD_MUSIC_BUTTON_PREFIX,
  musicRequestFromButton,
} from "./slash-commands";
import { loadDiscordMusicHistory } from "./music-history";
import {
  deleteDiscordMusicFavorites,
  loadDiscordMusicFavorites,
  moveDiscordMusicFavorite,
  saveDiscordMusicFavorite,
  loadDiscordMusicPlaylists,
  saveDiscordMusicPlaylist,
  saveDiscordMusicPlaylistLink,
  deleteDiscordMusicPlaylist,
  updateDiscordMusicPlaylist,
} from "./music-favorites";
import { getSpotifyArtistTopTracks } from "../../spotify-control";
import {
  loadDiscordMusicResumeData,
  saveDiscordMusicControllerReference,
} from "./music-resume-store";
import { loadChannelsSettings } from "../../settings-store";
import {
  shouldHandleDiscordInteraction,
  favoriteEntriesToTracks,
  isSpotifyPlaylistUrl,
  getDiscordSpotifyPlaylistChoices,
} from "./index";

const LOG = "[DiscordMusicController]";

export class DiscordMusicController {
  private musicControllerMessage: Message | null = null;
  private musicControllerRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private musicSearchSessions = new Map<
    string,
    { ownerId: string; tracks: DiscordMusicTrack[]; expiresAt: number }
  >();
  private favoriteSelections = new Map<string, string>();
  private selectedPlaylists = new Map<string, string>();

  constructor(
    private readonly getClient: () => Client | null,
    private readonly getVoiceCall: () => DiscordVoiceCall | null,
    private readonly interactionAsMessage: (
      interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    ) => Promise<Message>,
  ) {}

  hasRefreshTimer(): boolean {
    return this.musicControllerRefreshTimer !== null;
  }

  clearControllerMessage(): void {
    this.musicControllerMessage = null;
  }

  resetOnDisconnect(): void {
    this.stopMusicControllerRefresh();
    this.musicControllerMessage = null;
  }

  getSelectedPlaylistId(userId: string): string {
    return this.selectedPlaylists.get(userId) || "default";
  }

  rememberSearchSession(
    sessionId: string,
    session: { ownerId: string; tracks: DiscordMusicTrack[]; expiresAt: number },
  ): void {
    this.musicSearchSessions.set(sessionId, session);
  }

  async handleMusicButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.customId.startsWith(`${DISCORD_MUSIC_BUTTON_PREFIX}favorites-`)) {
      await this.handleFavoriteEditorButton(interaction);
      return;
    }
    if (interaction.customId.startsWith(`${DISCORD_MUSIC_BUTTON_PREFIX}playlist-`)) {
      await this.handlePlaylistEditorButton(interaction);
      return;
    }
    if (interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}save-track-only`) {
      if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
        await interaction.reply({
          content: "你沒有操作這個 Bot 的權限。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const current = this.getVoiceCall()?.getMusicState().current;
      if (!current) {
        await interaction.reply({
          content: "目前沒有正在播放的歌曲。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const saved = await saveDiscordMusicFavorite(current, "default");
      await interaction.update({
        content: saved.added
          ? `❤️ 已將「${current.title}」加入到「Bili/YT favorites」資料夾。`
          : `「${current.title}」已經在「Bili/YT favorites」資料夾中。`,
        components: [],
      });
      return;
    }
    if (interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}save-playlist-link`) {
      if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
        await interaction.reply({
          content: "你沒有操作這個 Bot 的權限。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const current = this.getVoiceCall()?.getMusicState().current;
      if (!current || !isSpotifyPlaylistUrl(current.playlistUrl) || !current.playlistTitle) {
        await interaction.reply({
          content: "目前沒有正在播放的 Spotify 歌單連結。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const saved = await saveDiscordMusicPlaylistLink(
        current.playlistTitle,
        current.playlistUrl,
        current.total,
      );
      const safeName = saved.playlist.name.replace(/[\[\]]/g, "").slice(0, 150);
      await interaction.update({
        content: saved.added
          ? `❤️ 已將整份 [${safeName}](${saved.playlist.url}) 的連結儲存到 \`/spotify\` Playlist。`
          : `[${safeName}](${saved.playlist.url}) 已經儲存在 \`/spotify\` Playlist。`,
        components: [],
      });
      return;
    }
    if (interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}source-link`) {
      if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
        await interaction.reply({
          content: "你沒有查看這個來源連結的權限。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const current = this.getVoiceCall()?.getMusicState().current;
      const url = current ? copyableDiscordMusicUrl(current.url) : null;
      if (!url) {
        await interaction.reply({
          content: "目前沒有可以複製的原始連結。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const visit = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("前往原始頁面")
          .setEmoji("↗️")
          .setStyle(ButtonStyle.Link)
          .setURL(url),
      );
      await interaction.reply({
        content: `📋 **可複製連結**\n\`\`\`text\n${url}\n\`\`\`\n要前往原始頁面嗎？`,
        components: [visit],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const state = this.getVoiceCall()?.getMusicState();
    const request = musicRequestFromButton(
      interaction.customId,
      state?.active ? state.paused : Boolean(state?.resumable),
      state?.shuffle ?? false,
      state?.repeat ?? "off",
      state?.autoplay ?? false,
      state?.volume ?? 100,
    );
    if (!request) return;
    const config = loadChannelsSettings().discord;
    const playlistOnly = request.command === "queue";
    const passiveAction = playlistOnly || request.command === "refresh";
    const accessConfig = passiveAction ? { ...config, allowedUserIds: undefined } : config;
    if (!shouldHandleDiscordInteraction(interaction, accessConfig)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!passiveAction && !this.getVoiceCall()?.canControlMusic(interaction.user.id)) {
      await interaction.reply({
        content: "這是其他人的播放工作階段，你不能使用這些控制按鈕。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (request.command === "queue") {
      await interaction.reply(
        state?.active
          ? { ...buildDiscordMusicQueue(state), flags: MessageFlags.Ephemeral }
          : { content: "目前沒有正在播放的音樂。", flags: MessageFlags.Ephemeral },
      );
      return;
    }
    if (request.command === "history") {
      await interaction.reply({
        ...buildDiscordMusicHistory(await loadDiscordMusicHistory(25)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (request.command === "favorites") {
      const selectedId = this.selectedPlaylists.get(interaction.user.id);
      await interaction.reply({
        ...(await this.getPlaylistsPayload(selectedId)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (request.command === "resume" && !state?.active && state?.resumable) {
      await interaction.deferUpdate();
      this.rememberMusicControllerMessage(interaction.message);
      const message = await this.interactionAsMessage(interaction);
      const voiceCall = this.getVoiceCall();
      const result = voiceCall
        ? await voiceCall.resumeSuspendedMusic(message)
        : { ok: false, message: "Discord 語音尚未啟用。" };
      if (result.ok && voiceCall) {
        await interaction.editReply(buildDiscordMusicPlayer(voiceCall.getMusicState()));
        this.startMusicControllerRefresh();
      } else {
        if (voiceCall)
          await interaction.editReply(buildDiscordMusicPlayer(voiceCall.getMusicState()));
        await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (request.command === "favorite") {
      if (!state?.current) {
        await interaction.reply({
          content: "目前沒有正在播放的歌曲。",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const track = state.current;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        if (isSpotifyPlaylistUrl(track.playlistUrl) && track.playlistTitle) {
          const saved = await saveDiscordMusicPlaylistLink(
            track.playlistTitle,
            track.playlistUrl,
            track.total,
          );
          await interaction.editReply({
            content: saved.added
              ? `❤️ 已將 Spotify 歌單「**${saved.playlist.name}**」的連結加入「**Spotify Playlist**」資料夾。`
              : `Spotify 歌單「**${saved.playlist.name}**」已經在「**Spotify Playlist**」資料夾中。`,
          });
        } else {
          const saved = await saveDiscordMusicFavorite(track, "default");
          await interaction.editReply({
            content: saved.added
              ? `❤️ 已將「**${track.title.replace(/[\[\]]/g, "")}**」加入到「**Bili/YT favorites**」資料夾！`
              : `「**${track.title.replace(/[\[\]]/g, "")}**」已經在「**Bili/YT favorites**」資料夾中囉！`,
          });
        }
      } catch (error) {
        await interaction.editReply({
          content: `無法收藏這首歌：${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }
    if (request.command === "refresh") {
      await interaction.deferUpdate();
      this.rememberMusicControllerMessage(interaction.message);
      if (state) await interaction.editReply(buildDiscordMusicPlayer(state));
      return;
    }
    await interaction.deferUpdate();
    this.rememberMusicControllerMessage(interaction.message);
    const voiceCall = this.getVoiceCall();
    const result = voiceCall
      ? await voiceCall.controlMusic(request.command!, request.value)
      : { ok: false, message: "Discord 語音尚未啟用。" };
    if (result.ok && voiceCall)
      await interaction.editReply(buildDiscordMusicPlayer(voiceCall.getMusicState()));
    if (!result.ok)
      await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
  }

  private async handleFavoriteEditorButton(interaction: ButtonInteraction): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有編輯收藏歌單的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const action = interaction.customId.slice(`${DISCORD_MUSIC_BUTTON_PREFIX}favorites-`.length);
    const selectedPlaylistId = this.selectedPlaylists.get(interaction.user.id) || "default";

    if (action === "add") {
      const input = new TextInputBuilder()
        .setCustomId("url")
        .setLabel("Music URL")
        .setPlaceholder("Bilibili / YouTube / Spotify 單曲連結")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${DISCORD_MUSIC_BUTTON_PREFIX}favorites-add-modal`)
          .setTitle("Add to favorites")
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
      );
      return;
    }
    if (action === "delete") {
      const input = new TextInputBuilder()
        .setCustomId("numbers")
        .setLabel("Track numbers")
        .setPlaceholder("e.g. 1 2 3")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${DISCORD_MUSIC_BUTTON_PREFIX}favorites-delete-modal`)
          .setTitle("Delete from playlists")
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
      );
      return;
    }
    const selectedId = this.favoriteSelections.get(interaction.user.id);
    if (!selectedId) {
      await interaction.reply({
        content: "Please select a track from the dropdown first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    if (action === "up" || action === "down") {
      await moveDiscordMusicFavorite(selectedId, action, selectedPlaylistId);
    }
    await interaction.editReply(await this.getPlaylistsPayload(selectedPlaylistId));
  }

  private async handlePlaylistEditorButton(interaction: ButtonInteraction): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "You don't have permission to edit playlists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const action = interaction.customId.slice(`${DISCORD_MUSIC_BUTTON_PREFIX}playlist-`.length);

    if (action === "back") {
      this.selectedPlaylists.delete(interaction.user.id);
      await interaction.deferUpdate();
      await interaction.editReply(await this.getPlaylistsPayload());
      return;
    }

    if (action === "add") {
      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Playlist Name")
        .setPlaceholder("e.g. Study, Gaming")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const urlInput = new TextInputBuilder()
        .setCustomId("url")
        .setLabel("Playlist URL (Optional)")
        .setPlaceholder("Spotify or YouTube playlist URL")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${DISCORD_MUSIC_BUTTON_PREFIX}playlist-add-modal`)
          .setTitle("Create Playlist")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
          ),
      );
      return;
    }

    if (action === "delete-menu") {
      const input = new TextInputBuilder()
        .setCustomId("numbers")
        .setLabel("Delete Playlist Numbers")
        .setPlaceholder("e.g. 2 3 4")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${DISCORD_MUSIC_BUTTON_PREFIX}playlist-delete-modal`)
          .setTitle("Delete Playlist")
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
      );
      return;
    }

    if (action === "edit") {
      const numberInput = new TextInputBuilder()
        .setCustomId("number")
        .setLabel("Playlist Number")
        .setPlaceholder("e.g. 2")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("New Display Name")
        .setPlaceholder("e.g. Night Drive")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const urlInput = new TextInputBuilder()
        .setCustomId("url")
        .setLabel("New Link (Optional)")
        .setPlaceholder("Leave blank to keep the current link")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${DISCORD_MUSIC_BUTTON_PREFIX}playlist-edit-modal`)
          .setTitle("Edit Playlist")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(numberInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
          ),
      );
      return;
    }

    if (action === "play-all") {
      const voiceCallForPlayAll = this.getVoiceCall();
      if (
        voiceCallForPlayAll?.getMusicState().active &&
        !voiceCallForPlayAll.canControlMusic(interaction.user.id)
      ) {
        await interaction.reply({
          content: "This is someone else's playback session, you cannot play this playlist.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const selectedId = this.selectedPlaylists.get(interaction.user.id) || "default";
      const favorites = await loadDiscordMusicFavorites(500, selectedId);
      if (!favorites.length) {
        await interaction.reply({
          content: "This playlist is empty.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const message = await this.interactionAsMessage(interaction);
      const handled =
        (await this.getVoiceCall()?.handleResolvedMusicTracks(
          message,
          await favoriteEntriesToTracks(favorites),
        )) ?? false;
      if (!handled || !this.getVoiceCall()?.getMusicState().active) {
        await interaction.editReply({
          content: "Could not start playing. Please join a voice channel first.",
        });
        return;
      }
      await interaction.editReply({ content: "Started playing the playlist!" });
      await this.showMusicController(interaction);
      return;
    }
  }

  private async getPlaylistsPayload(selectedPlaylistId?: string) {
    await getDiscordSpotifyPlaylistChoices().catch(() => []);
    return buildDiscordMusicPlaylists(await loadDiscordMusicPlaylists(), selectedPlaylistId);
  }

  async handleFavoriteModal(interaction: ModalSubmitInteraction): Promise<void> {
    const isAdd = interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}favorites-add-modal`;
    const isDelete =
      interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}favorites-delete-modal`;
    const isPlaylistAdd =
      interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}playlist-add-modal`;
    const isPlaylistDelete =
      interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}playlist-delete-modal`;
    const isPlaylistEdit =
      interaction.customId === `${DISCORD_MUSIC_BUTTON_PREFIX}playlist-edit-modal`;
    if (!isAdd && !isDelete && !isPlaylistAdd && !isPlaylistDelete && !isPlaylistEdit) return;

    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "You don't have permission to edit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (isPlaylistAdd) {
        const name = interaction.fields.getTextInputValue("name").trim();
        const url = interaction.fields.getTextInputValue("url")?.trim();
        const cleanUrl = url ? (findDiscordMusicUrl(url) ?? url) : "";
        if (cleanUrl && isSpotifyPlaylistUrl(cleanUrl)) {
          const saved = await saveDiscordMusicPlaylistLink(name, cleanUrl);
          if (interaction.message) {
            await interaction.message.edit(await this.getPlaylistsPayload()).catch(() => undefined);
          }
          await interaction.editReply({
            content: saved.added
              ? `📀 Spotify playlist "${saved.playlist.name}" 已加入 Spotify Playlist 資料夾。`
              : `Spotify playlist "${saved.playlist.name}" 已經存在。`,
          });
          return;
        }
        let tracks: DiscordMusicTrack[] = [];
        if (cleanUrl) {
          tracks = await resolveDiscordMusicTracks(cleanUrl);
        }
        const created = await saveDiscordMusicPlaylist(name, cleanUrl, tracks);
        if (interaction.message) {
          await interaction.message.edit(await this.getPlaylistsPayload()).catch(() => undefined);
        }
        await interaction.editReply({
          content: `📂 Playlist "${created.name}" created successfully${tracks.length > 0 ? ` with ${tracks.length} tracks` : ""}.`,
        });
        return;
      }

      if (isPlaylistDelete) {
        const raw = interaction.fields.getTextInputValue("numbers").trim();
        const tokens = raw.split(/\s+/).filter(Boolean);
        const playlists = await loadDiscordMusicPlaylists();
        const displayedPlaylists = [
          ...playlists.filter((playlist) => playlist.folder !== "spotify"),
          ...playlists.filter((playlist) => playlist.folder === "spotify"),
        ];
        if (!tokens.length || tokens.some((token) => !/^\d+$/.test(token))) {
          await interaction.editReply({
            content: "Enter playlist numbers separated by spaces, e.g. 2 3 4.",
          });
          return;
        }
        const numbers = [...new Set(tokens.map(Number))];
        if (numbers.some((number) => number < 1 || number > displayedPlaylists.length)) {
          await interaction.editReply({
            content: `Invalid number. Available range is 1-${displayedPlaylists.length}.`,
          });
          return;
        }
        const targets = numbers.map((number) => displayedPlaylists[number - 1]);
        if (targets.some((target) => target.id === "default")) {
          await interaction.editReply({
            content: 'The default playlist "💖 My Favorites" cannot be deleted.',
          });
          return;
        }
        for (const target of targets) await deleteDiscordMusicPlaylist(target.id);
        const selectedId = this.selectedPlaylists.get(interaction.user.id);
        if (selectedId && targets.some((target) => target.id === selectedId))
          this.selectedPlaylists.delete(interaction.user.id);

        if (interaction.message) {
          await interaction.message.edit(await this.getPlaylistsPayload()).catch(() => undefined);
        }
        await interaction.editReply({
          content: `🗑️ Deleted ${targets.length} playlist${targets.length === 1 ? "" : "s"}: ${targets.map((target) => `"${target.name}"`).join(", ")}.`,
        });
        return;
      }

      if (isPlaylistEdit) {
        const number = Number(interaction.fields.getTextInputValue("number").trim());
        const name = interaction.fields.getTextInputValue("name").trim();
        const url = interaction.fields.getTextInputValue("url")?.trim();
        const playlists = await loadDiscordMusicPlaylists();
        const displayedPlaylists = [
          ...playlists.filter((playlist) => playlist.folder !== "spotify"),
          ...playlists.filter((playlist) => playlist.folder === "spotify"),
        ];
        if (!Number.isInteger(number) || number < 1 || number > displayedPlaylists.length) {
          await interaction.editReply({
            content: `Invalid number. Available range is 1-${displayedPlaylists.length}.`,
          });
          return;
        }
        const target = displayedPlaylists[number - 1];
        const cleanUrl = url ? (findDiscordMusicUrl(url) ?? url) : undefined;
        const updated = await updateDiscordMusicPlaylist(target.id, { name, url: cleanUrl });
        if (interaction.message)
          await interaction.message.edit(await this.getPlaylistsPayload()).catch(() => undefined);
        await interaction.editReply({
          content: updated
            ? `✏️ Playlist ${number} is now "${updated.name}".`
            : "Playlist not found.",
        });
        return;
      }

      const selectedPlaylistId = this.selectedPlaylists.get(interaction.user.id) || "default";

      if (isDelete) {
        const raw = interaction.fields.getTextInputValue("numbers").trim();
        const tokens = raw.split(/\s+/).filter(Boolean);
        if (!tokens.length || tokens.some((token) => !/^\d+$/.test(token))) {
          await interaction.editReply({
            content: 'Please enter track numbers separated by space, e.g. "1 2 3 4".',
          });
          return;
        }
        const favorites = await loadDiscordMusicFavorites(100, selectedPlaylistId);
        const visibleCount = Math.min(25, favorites.length);
        const numbers = [...new Set(tokens.map(Number))];
        const invalid = numbers.filter((number) => number < 1 || number > visibleCount);
        if (invalid.length) {
          await interaction.editReply({
            content: `Could not find track ${invalid.join(", ")}; available range is 1-${visibleCount}.`,
          });
          return;
        }
        const ids = numbers.map((number) => favorites[number - 1].id);
        const deleted = await deleteDiscordMusicFavorites(ids, selectedPlaylistId);
        const selectedId = this.favoriteSelections.get(interaction.user.id);
        if (selectedId && ids.includes(selectedId))
          this.favoriteSelections.delete(interaction.user.id);
        if (interaction.message) {
          await interaction.message
            .edit(await this.getPlaylistsPayload(selectedPlaylistId))
            .catch(() => undefined);
        }
        await interaction.editReply({ content: `Deleted ${deleted} tracks from the playlist.` });
        return;
      }

      // Add track to playlist
      const input = interaction.fields.getTextInputValue("url").trim();
      const track = (await resolveDiscordMusicTracks(findDiscordMusicUrl(input) ?? input))[0];
      if (!track) {
        await interaction.editReply({ content: "No track found from this link." });
        return;
      }
      const saved = await saveDiscordMusicFavorite(track, selectedPlaylistId);
      if (interaction.message) {
        await interaction.message
          .edit(await this.getPlaylistsPayload(selectedPlaylistId))
          .catch(() => undefined);
      }
      await interaction.editReply({
        content: saved.added
          ? `❤️ Added "${saved.entry.title}" to the current playlist.`
          : `"${saved.entry.title}" is already in this playlist.`,
      });
    } catch (error) {
      await interaction.editReply({
        content: `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async handlePlaylistSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "You don't have permission to view playlists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const playlistId = interaction.values[0];
    if (playlistId.startsWith("spotify:")) {
      const spotifyId = playlistId.slice("spotify:".length);
      const spotifyPlaylists = await getDiscordSpotifyPlaylistChoices().catch(() => []);
      const spotifyPlaylist = spotifyPlaylists.find((p) => p.id === spotifyId);
      if (spotifyPlaylist) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = await this.interactionAsMessage(interaction);
        const handled =
          (await this.getVoiceCall()?.handleMusicRequest(message, { url: spotifyPlaylist.url }, true)) ??
          false;
        if (handled && this.getVoiceCall()?.getMusicState().active) {
          await this.showMusicController(interaction);
        }
        return;
      }
    }
    this.selectedPlaylists.set(interaction.user.id, playlistId);
    await interaction.deferUpdate();
    await interaction.editReply(await this.getPlaylistsPayload(playlistId));
  }

  async handleMusicSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (interaction.customId.startsWith("cyrene:music:search:")) {
      await this.handleMusicSearchSelect(interaction);
      return;
    }
    if (interaction.customId === "cyrene:music:playlist-select") {
      await this.handlePlaylistSelect(interaction);
      return;
    }
    if (interaction.customId === "cyrene:music:favorites-select") {
      await this.handleMusicFavoriteSelect(interaction);
      return;
    }
    if (interaction.customId === "cyrene:music:spotify-select") {
      await this.handleSpotifyPlaylistSelect(interaction);
      return;
    }
    if (interaction.customId === "cyrene:music:spotify-artist-select") {
      await this.handleSpotifyArtistSelect(interaction);
      return;
    }
    if (interaction.customId !== "cyrene:music:volume") return;
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!this.getVoiceCall()?.canControlMusic(interaction.user.id)) {
      await interaction.reply({
        content: "這是其他人的播放工作階段，你不能調整音量。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    this.rememberMusicControllerMessage(interaction.message);
    const value = Number.parseInt(interaction.values[0] ?? "100", 10);
    const voiceCall = this.getVoiceCall();
    const result = voiceCall
      ? await voiceCall.controlMusic("volume", value)
      : { ok: false, message: "Discord 語音尚未啟用。" };
    if (result.ok && voiceCall)
      await interaction.editReply(buildDiscordMusicPlayer(voiceCall.getMusicState()));
    if (!result.ok)
      await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
  }

  private async handleMusicSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const sessionId = interaction.customId.slice("cyrene:music:search:".length);
    const session = this.musicSearchSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      this.musicSearchSessions.delete(sessionId);
      await interaction.reply({
        content: "這份搜尋結果已過期，請重新使用 `/play`。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: "只有發起搜尋的人可以選擇歌曲。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const index = Number.parseInt(interaction.values[0] ?? "-1", 10);
    const track = session.tracks[index];
    if (!track) {
      await interaction.reply({
        content: "找不到這首歌曲，請重新搜尋。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    this.musicSearchSessions.delete(sessionId);
    await interaction.deferUpdate();
    await interaction.editReply({
      content: `🔎 正在讀取「${track.title}」…`,
      embeds: [],
      components: [],
    });
    const message = await this.interactionAsMessage(interaction);
    const handled =
      (await this.getVoiceCall()?.handleMusicRequest(message, { url: track.url })) ?? false;
    if (!handled || !this.getVoiceCall()?.getMusicState().active) {
      await interaction.editReply({
        content: "無法開始播放，請確認你已加入語音頻道。",
        embeds: [],
        components: [],
      });
      return;
    }
    this.rememberMusicControllerMessage(interaction.message);
    await this.showMusicController(interaction);
    this.startMusicControllerRefresh();
  }

  private async handleMusicFavoriteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const voiceCallForFavoriteSelect = this.getVoiceCall();
    if (
      voiceCallForFavoriteSelect?.getMusicState().active &&
      !voiceCallForFavoriteSelect.canControlMusic(interaction.user.id)
    ) {
      await interaction.reply({
        content: "This is someone else's playback session, you cannot add tracks.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const selectedPlaylistId = this.selectedPlaylists.get(interaction.user.id) || "default";
    const favorites = await loadDiscordMusicFavorites(500, selectedPlaylistId);
    const selectedIndex = favorites.findIndex((entry) => entry.id === interaction.values[0]);
    if (selectedIndex < 0) {
      await interaction.reply({
        content: "Track not found, please reopen favorites list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    this.favoriteSelections.set(interaction.user.id, favorites[selectedIndex].id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await this.interactionAsMessage(interaction);
    const playable = await favoriteEntriesToTracks(favorites.slice(selectedIndex));
    const handled =
      (await this.getVoiceCall()?.handleResolvedMusicTracks(message, playable, true)) ?? false;
    if (!handled || !this.getVoiceCall()?.getMusicState().active) {
      await interaction.editReply({
        content: "Could not start playing. Please make sure you are in a voice channel.",
        embeds: [],
        components: [],
      });
      return;
    }
    await interaction.editReply({
      content: `Started playing track #${selectedIndex + 1} from your playlist.`,
    });
    await this.showMusicController(interaction);
  }

  private async handleSpotifyPlaylistSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const playlist = (await getDiscordSpotifyPlaylistChoices()).find(
        (item) => item.id === interaction.values[0],
      );
      if (!playlist) {
        await interaction.editReply({
          content: "找不到這個 Spotify 播放清單，請重新使用 `/spotify`。",
        });
        return;
      }
      const message = await this.interactionAsMessage(interaction);
      const handled =
        (await this.getVoiceCall()?.handleMusicRequest(message, { url: playlist.url }, true)) ?? false;
      if (handled && this.getVoiceCall()?.getMusicState().active) {
        await this.showMusicController(interaction);
      }
    } catch (error) {
      console.error(LOG, "Spotify playlist select failed:", error);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Forbidden") || msg.includes("403")) {
        await interaction.editReply({
          content: `無法讀取此播放清單。因 Spotify 官方在 2026 年 2 月修改了 API 政策，非你創建或協作的歌單（例如他人創建的公開歌單）限制透過 API 讀取。\n\n💡 **解決辦法**：請複製該歌單網址，直接使用 \`/play\` 指令播歌喔！(•͈⌔•͈⑅)`,
        });
      } else {
        await interaction.editReply({ content: `Spotify 播放清單讀取失敗：${msg}` });
      }
    }
  }

  private async handleSpotifyArtistSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!shouldHandleDiscordInteraction(interaction, loadChannelsSettings().discord)) {
      await interaction.reply({
        content: "你沒有操作這個 Bot 的權限。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.editReply({ content: "🔎 正在讀取作者的熱門歌曲…" });
      const tracks = await getSpotifyArtistTopTracks(interaction.values[0] ?? "");
      if (!tracks.length) {
        await interaction.editReply({ content: "這位作者目前沒有可播放的熱門歌曲。" });
        return;
      }
      const message = await this.interactionAsMessage(interaction);
      const handled = (await this.getVoiceCall()?.handleResolvedMusicTracks(message, tracks)) ?? false;
      if (handled && this.getVoiceCall()?.getMusicState().active) {
        await this.showMusicController(interaction);
      }
    } catch (error) {
      await interaction.editReply({
        content: `Spotify 作者歌曲讀取失敗：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (interaction.commandName === "list") {
      const focusedOption = interaction.options.getFocused(true);
      if (focusedOption.name === "name") {
        try {
          const filterValue = focusedOption.value.toLowerCase();
          const choices: { name: string; value: string }[] = [];

          // Load YT/Bili liked songs with "liked:" prefix on value
          const likedPlaylists = await loadDiscordMusicPlaylists().catch(() => []);
          const likedTracks = likedPlaylists.flatMap((p) => p.tracks);
          for (const t of likedTracks) {
            choices.push({
              name: `🎵 ${t.title}`.slice(0, 100),
              value: `liked:${t.url}`,
            });
          }

          // Load Spotify playlists with "spotify:" prefix on value
          const spotifyPlaylists = await getDiscordSpotifyPlaylistChoices().catch(() => []);
          for (const p of spotifyPlaylists) {
            choices.push({
              name: `🟢 ${p.name} (${p.total} 首)`.slice(0, 100),
              value: `spotify:${p.id}`,
            });
          }

          const filtered = choices
            .filter((c) => c.name.toLowerCase().includes(filterValue))
            .slice(0, 25);
          await interaction.respond(filtered);
        } catch (error) {
          console.error(LOG, "List autocomplete error:", error);
          await interaction.respond([]);
        }
      } else {
        await interaction.respond([]);
      }
    } else {
      await interaction.respond([]);
    }
  }

  stopMusicControllerRefresh(): void {
    if (this.musicControllerRefreshTimer) clearInterval(this.musicControllerRefreshTimer);
    this.musicControllerRefreshTimer = null;
  }

  startMusicControllerRefresh(): void {
    this.stopMusicControllerRefresh();
    this.musicControllerRefreshTimer = setInterval(() => {
      const state = this.getVoiceCall()?.getMusicState();
      void this.getVoiceCall()
        ?.checkpointMusicSession()
        .catch((error) => console.warn(LOG, "保存 Discord 播放進度失敗:", error));
      if (state) void this.refreshMusicController(state);
    }, 5_000);
  }

  async resolveStoredMusicControllerMessage(): Promise<Message | null> {
    const MAX_CONTROLLER_AGE_MS = 60 * 60 * 1000; // 超過1小時不播歌或無操作，舊面板自動作廢，發送新面板至頻道最下方
    if (this.musicControllerMessage) {
      if (Date.now() - this.musicControllerMessage.createdTimestamp > MAX_CONTROLLER_AGE_MS) {
        this.musicControllerMessage = null;
        return null;
      }
      return this.musicControllerMessage;
    }
    const client = this.getClient();
    if (!client) return null;
    const resumeData = await loadDiscordMusicResumeData().catch(() => null);
    const reference = resumeData?.controller;
    if (!reference) return null;
    try {
      const channel = await client.channels.fetch(reference.channelId);
      if (!channel || !("messages" in channel)) return null;
      const message = await channel.messages.fetch(reference.messageId);
      if (Date.now() - message.createdTimestamp > MAX_CONTROLLER_AGE_MS) {
        this.musicControllerMessage = null;
        return null;
      }
      this.musicControllerMessage = message;
      return message;
    } catch {
      return null;
    }
  }

  async showMusicController(interaction: RepliableInteraction): Promise<void> {
    const state = this.getVoiceCall()?.getMusicState();
    if (!state) return;
    const payload = buildDiscordMusicPlayer(state);
    let existing = await this.resolveStoredMusicControllerMessage();
    let updatedExisting = false;
    if (existing && existing.channelId === interaction.channelId) {
      updatedExisting = await existing
        .edit(payload)
        .then(() => true)
        .catch(() => false);
      if (!updatedExisting) {
        this.musicControllerMessage = null;
        existing = null;
      }
    }
    if (updatedExisting) {
      await interaction.deleteReply().catch(() => undefined);
    } else if (interaction.channel?.isSendable()) {
      const sent = await interaction.channel.send(payload);
      this.rememberMusicControllerMessage(sent);
      await interaction.deleteReply().catch(() => undefined);
    } else {
      await interaction.editReply(payload);
      this.rememberMusicControllerMessage(await interaction.fetchReply());
    }
    this.startMusicControllerRefresh();
  }

  rememberMusicControllerMessage(message: Message): void {
    this.musicControllerMessage = message;
    void saveDiscordMusicControllerReference(message.channelId, message.id).catch((error) =>
      console.warn(LOG, "保存 Discord 播放器訊息位置失敗:", error),
    );
  }

  async restoreMusicControllerMessage(client: Client): Promise<void> {
    const reference = (await loadDiscordMusicResumeData()).controller;
    if (!reference) return;
    try {
      const channel = await client.channels.fetch(reference.channelId);
      if (!channel || !("messages" in channel)) return;
      const message = await channel.messages.fetch(reference.messageId);
      if (Date.now() - message.createdTimestamp > 60 * 60 * 1000) {
        this.musicControllerMessage = null;
        return;
      }
      await message.edit(buildDiscordMusicPlayer(this.getVoiceCall()!.getMusicState()));
      this.musicControllerMessage = message;
    } catch (error) {
      console.warn(LOG, "重開後找不到上一則 Discord 播放器訊息:", error);
    }
  }

  async refreshMusicController(state?: DiscordMusicState): Promise<void> {
    const currentState = this.getVoiceCall()?.getMusicState() ?? state;
    if (!currentState) return;
    let message = this.musicControllerMessage;
    if (!message && this.getClient()) {
      message = await this.resolveStoredMusicControllerMessage().catch(() => null);
    }
    if (!message) return;
    try {
      const updated = await message.edit(buildDiscordMusicPlayer(currentState));
      this.musicControllerMessage = updated;
      if (!currentState.active) {
        this.stopMusicControllerRefresh();
      }
    } catch (err: any) {
      console.warn(LOG, "更新 Discord 音樂播放器失敗:", err);
      const code = err?.code ?? err?.rawError?.code;
      if (code === 10008 || code === 10003 || err?.status === 404) {
        this.stopMusicControllerRefresh();
        this.musicControllerMessage = null;
      }
    }
  }

  musicRequestFromInteraction(interaction: ChatInputCommandInteraction) {
    if (interaction.commandName === "play") {
      const input = interaction.options.getString("url", false);
      if (!input) return { url: "" };
      return { url: findDiscordMusicUrl(input) ?? input };
    }
    if (interaction.commandName === "pause") return { command: "pause" as const };
    if (interaction.commandName === "resume") return { command: "resume" as const };
    if (interaction.commandName === "previous") return { command: "previous" as const };
    if (interaction.commandName === "next") return { command: "skip" as const };
    if (interaction.commandName === "stop") return { command: "stop" as const };
    if (interaction.commandName === "queue") return { command: "queue" as const };
    if (interaction.commandName === "clear") return { command: "clear" as const };
    if (interaction.commandName === "remove") {
      return {
        command: "remove" as const,
        value: interaction.options.getInteger("position", true),
      };
    }
    if (interaction.commandName === "volume") {
      return { command: "volume" as const, value: interaction.options.getInteger("percent", true) };
    }
    if (interaction.commandName === "repeat") {
      const mode = interaction.options.getString("mode", true);
      return {
        command:
          mode === "track"
            ? ("repeat-track" as const)
            : mode === "queue"
              ? ("repeat-queue" as const)
              : ("repeat-off" as const),
      };
    }
    if (interaction.commandName === "mode") {
      return {
        command:
          interaction.options.getString("type", true) === "shuffle"
            ? ("shuffle" as const)
            : ("ordered" as const),
      };
    }
    if (interaction.commandName === "autoplay") {
      return {
        command: interaction.options.getBoolean("enabled", true)
          ? ("autoplay-on" as const)
          : ("autoplay-off" as const),
      };
    }
    return null;
  }
}

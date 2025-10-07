import {
  Client,
  GatewayIntentBits,
  Guild,
  TextChannel,
  ChannelType,
  PermissionsBitField,
  CategoryChannel,
  GuildBasedChannel,
  Message,
  Attachment,
  OverwriteType,
} from 'discord.js';

export interface DiscordSetupResult {
  guild: Guild;
  statusChannel: TextChannel;
  feedbackChannel: TextChannel;
}

export class DiscordManager {
  private client: Client;
  private botToken: string;
  private desiredGuildName: string;
  private statusChannelName: string;
  private feedbackChannelName: string;
  private categoryName?: string;
  private feedbackChannelId?: string;
  private guild?: Guild;

  constructor(options?: {
    botToken?: string;
    guildName?: string;
    statusChannelName?: string;
    feedbackChannelName?: string;
    categoryName?: string;
  }) {
    this.botToken = options?.botToken || process.env.DISCORD_BOT_TOKEN || '';
    this.desiredGuildName =
      options?.guildName || process.env.DISCORD_GUILD_NAME || 'Auto Claude Project';
    this.categoryName = options?.categoryName || process.env.DISCORD_CATEGORY_NAME || undefined;

    // Append category name to channel names to make them unique per project
    const channelSuffix = this.categoryName ? `-${this.categoryName}` : '';
    this.statusChannelName =
      options?.statusChannelName ||
      `${process.env.DISCORD_STATUS_CHANNEL || 'status-updates'}${channelSuffix}`;
    this.feedbackChannelName =
      options?.feedbackChannelName ||
      `${process.env.DISCORD_FEEDBACK_CHANNEL || 'feedback'}${channelSuffix}`;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async login(): Promise<void> {
    if (!this.botToken) {
      throw new Error('DISCORD_BOT_TOKEN is required');
    }
    // Wait for the client to be fully ready and guilds to be cached
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Discord login timeout')), 30000);
      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.client.login(this.botToken).catch(reject);
    });
  }

  async ensureGuildAndChannels(): Promise<DiscordSetupResult> {
    const byId = await this.fetchGuildById(process.env.DISCORD_GUILD_ID);
    const byName = this.client.guilds.cache.find((g: Guild) => g.name === this.desiredGuildName);
    const guild = byId ?? byName ?? (await this.createGuildIfPermitted());

    if (!guild) {
      throw new Error('Failed to create or locate Discord guild');
    }

    this.guild = guild;

    // Ensure category and channels
    const category = this.categoryName
      ? await this.ensureCategory(guild, this.categoryName)
      : undefined;
    const statusChannel = await this.ensureTextChannel(guild, this.statusChannelName, category);
    const feedbackChannel = await this.ensureTextChannel(guild, this.feedbackChannelName, category);
    this.feedbackChannelId = feedbackChannel.id;

    return { guild, statusChannel, feedbackChannel };
  }

  async sendStatusMessage(channel: TextChannel, message: string): Promise<void> {
    await channel.send(message);
  }

  async sendMessage(channelId: string, message: string): Promise<void> {
    try {
      const channel = await this.fetchChannel(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return;
      }

      // Discord message limit is 2000 characters
      const DISCORD_MESSAGE_LIMIT = 2000;

      if (message.length <= DISCORD_MESSAGE_LIMIT) {
        await (channel as TextChannel).send(message);
      } else {
        // Split message into chunks
        const chunks = this.splitMessage(message, DISCORD_MESSAGE_LIMIT);
        for (const chunk of chunks) {
          await (channel as TextChannel).send(chunk);
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch {
      // ignore send errors; caller will log
    }
  }

  private splitMessage(message: string, maxLength: number): string[] {
    if (message.length <= maxLength) {
      return [message];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    // Split by lines to avoid breaking mid-sentence
    const lines = message.split('\n');

    for (const line of lines) {
      // If a single line exceeds the limit, split it
      if (line.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        // Split long line by words
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + word + ' ').length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word + ' ';
          } else {
            currentChunk += word + ' ';
          }
        }
      } else if ((currentChunk + line + '\n').length > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // Add continuation markers
    return chunks.map((chunk, index) => {
      if (chunks.length > 1) {
        const prefix = index > 0 ? `**[Continued ${index + 1}/${chunks.length}]**\n` : '';
        const suffix = index < chunks.length - 1 ? '\n\n*(continued...)*' : '';
        return prefix + chunk + suffix;
      }
      return chunk;
    });
  }

  onFeedbackMessage(
    handler: (
      content: string,
      authorTag: string,
      attachments: Array<{ name: string; url: string }>
    ) => Promise<void> | void,
    opts?: { channelId?: string }
  ) {
    this.client.on('messageCreate', async (msg: Message) => {
      if (msg.author.bot) {
        return;
      }
      if (msg.channel.type !== ChannelType.GuildText) {
        return;
      }
      if (opts?.channelId && msg.channel.id !== opts.channelId) {
        return;
      }
      const channelName = (msg.channel as TextChannel).name;
      if (channelName !== this.feedbackChannelName) {
        return;
      }

      const attachments = Array.from(msg.attachments.values()).map((a: Attachment) => ({
        name: a.name ?? 'attachment',
        url: a.url,
      }));
      await handler(msg.content, `${msg.author.username}#${msg.author.discriminator}`, attachments);
    });
  }

  private async ensureCategory(guild: Guild, name: string): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find(
      (c: GuildBasedChannel) => c.type === ChannelType.GuildCategory && c.name === name
    ) as CategoryChannel | undefined;
    if (existing) {
      return existing;
    }

    const botId = this.client.user?.id;
    await this.ensureOwnerCached(guild);
    const category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        ...(botId
          ? [
              {
                id: botId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.EmbedLinks,
                  PermissionsBitField.Flags.AttachFiles,
                  PermissionsBitField.Flags.ReadMessageHistory,
                ],
                type: OverwriteType.Member,
              },
            ]
          : []),
        ...(guild.ownerId
          ? [
              {
                id: guild.ownerId,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.ReadMessageHistory,
                ],
                type: OverwriteType.Member,
              },
            ]
          : []),
      ],
    });
    return category as CategoryChannel;
  }

  private async createGuildIfPermitted(): Promise<Guild | undefined> {
    // Discord bots cannot create guilds via API. Return undefined and expect manual creation and bot invite.
    return undefined;
  }

  private async fetchGuildById(id?: string): Promise<Guild | undefined> {
    if (!id) {
      return undefined;
    }
    try {
      return await this.client.guilds.fetch(id);
    } catch {
      return undefined;
    }
  }

  private async ensureTextChannel(
    guild: Guild,
    name: string,
    parent?: CategoryChannel
  ): Promise<TextChannel> {
    const existing = guild.channels.cache.find(
      (c: GuildBasedChannel) => c.type === ChannelType.GuildText && (c as TextChannel).name === name
    ) as TextChannel | undefined;
    if (existing) {
      if (parent && existing.parentId !== parent.id) {
        try {
          await existing.setParent(parent);
        } catch {
          // ignore move errors
        }
      }
      return existing;
    }

    const botId = this.client.user?.id;
    await this.ensureOwnerCached(guild);
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      // If parent is provided, inherit privacy from category. Otherwise, set private here.
      ...(parent
        ? { parent: parent.id }
        : {
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
              },
              ...(botId
                ? [
                    {
                      id: botId,
                      allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                      ],
                      type: OverwriteType.Member,
                    },
                  ]
                : []),
              ...(guild.ownerId
                ? [
                    {
                      id: guild.ownerId,
                      allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.ReadMessageHistory,
                      ],
                      type: OverwriteType.Member,
                    },
                  ]
                : []),
            ],
          }),
    });
    if (parent) {
      try {
        await (channel as TextChannel).setParent(parent);
      } catch {
        // ignore
      }
    }
    return channel as TextChannel;
  }

  private async ensureOwnerCached(guild: Guild) {
    if (!guild.ownerId) {
      return;
    }
    try {
      await guild.members.fetch(guild.ownerId);
    } catch {
      // ignore
    }
  }

  private async fetchChannel(channelId: string) {
    if (this.guild) {
      const cached = this.guild.channels.cache.get(channelId);
      if (cached) {
        return cached;
      }
    }
    return this.client.channels.fetch(channelId);
  }
}

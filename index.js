JavaScript

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ==================== CONFIG ====================

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const ADMIN_ROLE_ID = process.env.AVL_ADMIN_ROLE_ID || "";

const DATA_FILE = path.join(__dirname, "data.json");

const COLORS = {
  navy: 0x101B35,
  gold: 0xD4AF37,
  red: 0xD64545,
  green: 0x2ECC71
};

const DAY = 24 * 60 * 60 * 1000;

// ==================== CHECK CONFIG ====================

if (!TOKEN || !CLIENT_ID) {
  console.error(
    "Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID environment variable."
  );
  process.exit(1);
}

// ==================== DATABASE ====================

function emptyDatabase() {
  return {
    players: {},
    teams: {},
    companies: {},
    matches: {},
    rewards: {},
    transactions: []
  };
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(emptyDatabase(), null, 2)
      );
    }

    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const defaults = emptyDatabase();

    return {
      ...defaults,
      ...loaded,
      players: loaded.players || {},
      teams: loaded.teams || {},
      companies: loaded.companies || {},
      matches: loaded.matches || {},
      rewards: loaded.rewards || {},
      transactions: loaded.transactions || []
    };
  } catch (error) {
    console.error("Could not load data.json:", error);
    process.exit(1);
  }
}

let db = loadDatabase();

function saveDatabase() {
  const temporaryFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(db, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

// ==================== HELPERS ====================

function normalize(value) {
  return String(value).trim().toLowerCase();
}

function money(amount) {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

function makeEmbed(title, description, color = COLORS.navy) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle("『💰』 AVL FINANCE")
    .setDescription(`**${title}**\n\n${description}`)
    .setFooter({ text: "AVL Finance System" })
    .setTimestamp();
}

function getPlayer(name) {
  const key = normalize(name);

  if (!db.players[key]) {
    db.players[key] = {
      name: String(name).trim(),
      balance: 0
    };
  }

  return db.players[key];
}

function getTeam(name, president = "غير محدد") {
  const key = normalize(name);

  if (!db.teams[key]) {
    db.teams[key] = {
      name: String(name).trim(),
      president: String(president).trim(),
      balance: 0
    };
  } else if (president && president !== "غير محدد") {
    db.teams[key].president = String(president).trim();
  }

  return db.teams[key];
}

function getCompany(name) {
  return db.companies[normalize(name)] || null;
}

function companyRules(purchasePrice) {
  if (purchasePrice >= 3000000 && purchasePrice < 3500000) {
    return {
      dailyProfit: 500000,
      maxSponsorship: 200000
    };
  }

  if (purchasePrice >= 3500000 && purchasePrice <= 4000000) {
    return {
      dailyProfit: 700000,
      maxSponsorship: 300000
    };
  }

  return null;
}

function accrueCompanyProfit(company) {
  const now = Date.now();
  const last = Number(company.lastAccrued || now);
  const fullDays = Math.floor((now - last) / DAY);

  if (fullDays > 0) {
    company.balance += fullDays * company.dailyProfit;
    company.lastAccrued = last + fullDays * DAY;
  }
}

function recordTransaction(type, details, amount) {
  db.transactions.push({
    type,
    details,
    amount,
    timestamp: Date.now()
  });

  // Keep the database from growing without limit.
  if (db.transactions.length > 2000) {
    db.transactions = db.transactions.slice(-2000);
  }
}

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  if (!ADMIN_ROLE_ID) {
    return false;
  }

  const member = interaction.member;
  return Boolean(
    member?.roles?.cache?.has(ADMIN_ROLE_ID) ||
    member?.roles?.includes?.(ADMIN_ROLE_ID)
  );
}

async function replyEmbed(interaction, embed, ephemeral = true) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ embeds: [embed], ephemeral });
  }

  return interaction.reply({ embeds: [embed], ephemeral });
}

async function adminOnly(interaction) {
  if (isAdmin(interaction)) return true;

  await replyEmbed(
    interaction,
    makeEmbed(
      "⛔ ماعندكش الصلاحية",
      "هاد الأمر مخصص للإدارة فقط."
    )
  );

  return false;
}

// ==================== SLASH COMMANDS ====================

const commands = [
  new SlashCommandBuilder()
    .setName("reward")
    .setDescription("احصل على مكافأتك اليومية"),

  new SlashCommandBuilder()
    .setName("give-money")
    .setDescription("إضافة المال إلى رصيد لاعب")
    .addStringOption(o =>
      o.setName("player")
        .setDescription("اسم اللاعب")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("المبلغ")
        .setMinValue(1)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("give-to-team")
    .setDescription("إضافة المال إلى رصيد فريق")
    .addStringOption(o =>
      o.setName("team")
        .setDescription("اسم الفريق")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("president")
        .setDescription("اسم رئيس الفريق")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("المبلغ")
        .setMinValue(1)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("give-to-player")
    .setDescription("تحويل المال من الفريق إلى لاعب")
    .addStringOption(o =>
      o.setName("player")
        .setDescription("اسم اللاعب")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("team")
        .setDescription("اسم الفريق الذي سيدفع")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("المبلغ")
        .setMinValue(1)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("create-company")
    .setDescription("تسجيل شركة جديدة")
    .addStringOption(o =>
      o.setName("company-name")
        .setDescription("اسم الشركة")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("purchase-price")
        .setDescription("ثمن شراء الشركة: من 3 إلى 4 ملايين")
        .setMinValue(3000000)
        .setMaxValue(4000000)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("view-all-companies")
    .setDescription("عرض جميع الشركات وأرباحها"),

  new SlashCommandBuilder()
    .setName("contracting-with-company")
    .setDescription("إبرام عقد رعاية بين شركة وفريق")
    .addStringOption(o =>
      o.setName("company")
        .setDescription("اسم الشركة")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("team")
        .setDescription("اسم الفريق")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("قيمة العقد")
        .setMinValue(1)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("match-reward")
    .setDescription("تسجيل نتيجة مباراة وصرف مكافأة الفريق")
    .addStringOption(o =>
      o.setName("match")
        .setDescription("اسم المباراة أو رقم الجولة")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("team-1")
        .setDescription("اسم الفريق الأول")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("team-2")
        .setDescription("اسم الفريق الثاني")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("result")
        .setDescription("نتيجة المباراة")
        .setRequired(true)
        .addChoices(
          { name: "فوز الفريق الأول", value: "team1" },
          { name: "فوز الفريق الثاني", value: "team2" },
          { name: "تعادل", value: "draw" }
        )),

  new SlashCommandBuilder()
    .setName("set-mvp")
    .setDescription("تحديد أفضل لاعب في مباراة وصرف مكافأته")
    .addStringOption(o =>
      o.setName("match")
        .setDescription("اسم المباراة المسجلة")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("player")
        .setDescription("اسم أفضل لاعب")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("team")
        .setDescription("الفريق الذي ينتمي إليه اللاعب")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("team-balance")
    .setDescription("عرض رصيد فريق")
    .addStringOption(o =>
      o.setName("team")
        .setDescription("اسم الفريق")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("player-balance")
    .setDescription("عرض رصيد لاعب")
    .addStringOption(o =>
      o.setName("player")
        .setDescription("اسم اللاعب")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("company-balance")
    .setDescription("عرض رصيد شركة")
    .addStringOption(o =>
      o.setName("company")
        .setDescription("اسم الشركة")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("rewards-match")
    .setDescription("عرض قوانين مكافآت المباريات")
].map(command => command.toJSON());

// ==================== DISCORD CLIENT ====================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ==================== REGISTER COMMANDS ====================

client.once("ready", async () => {
  console.log(`AVL Finance Bot is online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );

      console.log(`Registered ${commands.length} guild commands.`);
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );

      console.log(`Registered ${commands.length} global commands.`);
      console.log("Global commands may take time to appear.");
    }
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

// ==================== COMMAND HANDLER ====================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  try {
    // ---------- DAILY REWARD ----------

    if (command === "reward") {
      const userId = interaction.user.id;
      const now = Date.now();
      const lastReward = Number(db.rewards[userId] || 0);
      const remaining = DAY - (now - lastReward);

      if (lastReward && remaining > 0) {
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.ceil((remaining % (60 * 60 * 1000)) / 60000);

        return replyEmbed(
          interaction,
          makeEmbed(
            "⏳ المكافأة اليومية",
            `لقد حصلت على مكافأتك من قبل.\nيمكنك المحاولة بعد **${hours} ساعة و${minutes} دقيقة**.`
          )
        );
      }

      const player = getPlayer(interaction.user.username);
      player.balance += 20;
      db.rewards[userId] = now;

      recordTransaction(
        "daily-reward",
        interaction.user.username,
        20
      );

      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "🎁 تم استلام المكافأة",
          `اللاعب: **${interaction.user.username}**\nالمكافأة: **${money(20)}**\nالرصيد الجديد: **${money(player.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- GIVE MONEY ----------

    if (command === "give-money") {
      if (!(await adminOnly(interaction))) return;

      const name = interaction.options.getString("player");
      const amount = interaction.options.getInteger("amount");
      const player = getPlayer(name);

      player.balance += amount;

      recordTransaction("give-money", name, amount);
      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "💸 تم تحويل المال",
          `اللاعب: **${player.name}**\nالمبلغ: **${money(amount)}**\nالرصيد الجديد: **${money(player.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- GIVE TO TEAM ----------

    if (command === "give-to-team") {
      if (!(await adminOnly(interaction))) return;

      const name = interaction.options.getString("team");
      const president = interaction.options.getString("president");
      const amount = interaction.options.getInteger("amount");
      const team = getTeam(name, president);

      team.balance += amount;

      recordTransaction("give-to-team", team.name, amount);
      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "🏆 تم تمويل الفريق",
          `الفريق: **${team.name}**\nالرئيس: **${team.president}**\nالمبلغ: **${money(amount)}**\nالرصيد: **${money(team.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- GIVE TO PLAYER ----------

    if (command === "give-to-player") {
      if (!(await adminOnly(interaction))) return;

      const playerName = interaction.options.getString("player");
      const teamName = interaction.options.getString("team");
      const amount = interaction.options.getInteger("amount");

      const team = db.teams[normalize(teamName)];

      if (!team) {
        return replyEmbed(
          interaction,
          makeEmbed("❌ الفريق غير موجود", "سجّل رصيد الفريق أولاً باستعمال `/give-to-team`.")
        );
      }

      if (team.balance < amount) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ رصيد الفريق غير كافٍ",
            `رصيد الفريق: **${money(team.balance)}**\nالمبلغ المطلوب: **${money(amount)}**`
          )
        );
      }

      const player = getPlayer(playerName);

      team.balance -= amount;
      player.balance += amount;

      recordTransaction(
        "team-to-player",
        `${team.name} -> ${player.name}`,
        amount
      );

      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "🤝 تم تحويل المال للاعب",
          `الفريق: **${team.name}**\nاللاعب: **${player.name}**\nالمبلغ: **${money(amount)}**\nرصيد الفريق: **${money(team.balance)}**\nرصيد اللاعب: **${money(player.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- CREATE COMPANY ----------

    if (command === "create-company") {
      if (!(await adminOnly(interaction))) return;

      const name = interaction.options.getString("company-name").trim();
      const price = interaction.options.getInteger("purchase-price");
      const key = normalize(name);

      if (db.companies[key]) {
        return replyEmbed(
          interaction,
          makeEmbed("❌ الشركة مسجلة من قبل", "اختَر اسماً مختلفاً للشركة.")
        );
      }

      const rules = companyRules(price);

      if (!rules) {
        return replyEmbed(
          interaction,
          makeEmbed("❌ ثمن غير صالح", "ثمن الشركة يجب أن يكون بين 3,000,000 و4,000,000 دولار.")
        );
      }

      db.companies[key] = {
        name,
        owner: interaction.user.tag,
        purchasePrice: price,
        balance: 0,
        dailyProfit: rules.dailyProfit,
        maxSponsorship: rules.maxSponsorship,
        lastAccrued: Date.now(),
        contracts: []
      };

      recordTransaction("create-company", name, price);
      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "🏢 تم تسجيل الشركة",
          `الشركة: **${name}**\nالمالك المسجل: **${interaction.user.tag}**\nثمن الشراء: **${money(price)}**\nالأرباح اليومية: **${money(rules.dailyProfit)}**\nأقصى عقد رعاية: **${money(rules.maxSponsorship)}**\nرصيد الشركة الأولي: **${money(0)}**`,
          COLORS.green
        )
      );
    }

    // ---------- VIEW ALL COMPANIES ----------

    if (command === "view-all-companies") {
      for (const company of Object.values(db.companies)) {
        accrueCompanyProfit(company);
      }

      saveDatabase();

      const companies = Object.values(db.companies);

      if (companies.length === 0) {
        return replyEmbed(
          interaction,
          makeEmbed("🏢 الشركات", "مازال ما تسجلات حتى شركة.")
        );
      }

      const lines = companies.map((company, index) =>
        `**${index + 1}. ${company.name}**\n` +
        `المالك: ${company.owner}\n` +
        `الرصيد: ${money(company.balance)}\n` +
        `الربح اليومي: ${money(company.dailyProfit)}\n` +
        `أقصى رعاية: ${money(company.maxSponsorship)}`
      );

      const pages = [];
      let current = "";

      for (const line of lines) {
        if ((current + "\n\n" + line).length > 3800) {
          pages.push(current);
          current = line;
        } else {
          current = current ? current + "\n\n" + line : line;
        }
      }

      if (current) pages.push(current);

      await replyEmbed(
        interaction,
        makeEmbed(
          `🏢 جميع الشركات (${companies.length})`,
          pages[0]
        )
      );

      for (let i = 1; i < pages.length; i++) {
        await interaction.followUp({
          embeds: [
            makeEmbed(`🏢 الشركات — صفحة ${i + 1}`, pages[i])
          ],
          ephemeral: true
        });
      }

      return;
    }

    // ---------- COMPANY CONTRACT ----------

    if (command === "contracting-with-company") {
      if (!(await adminOnly(interaction))) return;

      const companyName = interaction.options.getString("company");
      const teamName = interaction.options.getString("team");
      const amount = interaction.options.getInteger("amount");

      const company = getCompany(companyName);

      if (!company) {
        return replyEmbed(
          interaction,
          makeEmbed("❌ الشركة غير موجودة", "تأكد من اسم الشركة أو سجّلها أولاً.")
        );
      }

      accrueCompanyProfit(company);

      if (amount > company.maxSponsorship) {
        saveDatabase();

        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ قيمة العقد كبيرة",
            `أقصى قيمة للرعاية من هذه الشركة هي **${money(company.maxSponsorship)}**.`
          )
        );
      }

      if (company.balance < amount) {
        saveDatabase();

        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ رصيد الشركة غير كافٍ",
            `رصيد الشركة: **${money(company.balance)}**\nقيمة العقد: **${money(amount)}**\nالأرباح اليومية: **${money(company.dailyProfit)}**`
          )
        );
      }

      const team = getTeam(teamName);

      company.balance -= amount;
      team.balance += amount;

      company.contracts.push({
        team: team.name,
        amount,
        date: Date.now()
      });

      recordTransaction(
        "company-contract",
        `${company.name} -> ${team.name}`,
        amount
      );

      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "📝 تم إبرام عقد الرعاية",
          `الشركة: **${company.name}**\nالفريق: **${team.name}**\nقيمة العقد: **${money(amount)}**\nرصيد الشركة: **${money(company.balance)}**\nرصيد الفريق: **${money(team.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- MATCH REWARD ----------

    if (command === "match-reward") {
      if (!(await adminOnly(interaction))) return;

      const matchName = interaction.options.getString("match").trim();
      const team1Name = interaction.options.getString("team-1").trim();
      const team2Name = interaction.options.getString("team-2").trim();
      const result = interaction.options.getString("result");
      const matchKey = normalize(matchName);

      if (normalize(team1Name) === normalize(team2Name)) {
        return replyEmbed(
          interaction,
          makeEmbed("❌ خطأ", "خاص الفريق الأول يكون مختلف على الفريق الثاني.")
        );
      }

      if (db.matches[matchKey]) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ المباراة مسجلة من قبل",
            "استعمل اسماً مختلفاً للمباراة حتى ما تتصرفش المكافآت مرتين."
          )
        );
      }

      const team1 = getTeam(team1Name);
      const team2 = getTeam(team2Name);

      let team1Reward = 0;
      let team2Reward = 0;
      let resultText = "";

      if (result === "team1") {
        team1Reward = 100000;
        resultText = `الفائز: **${team1.name}**`;
      } else if (result === "team2") {
        team2Reward = 100000;
        resultText = `الفائز: **${team2.name}**`;
      } else if (result === "draw") {
        team1Reward = 50000;
        team2Reward = 50000;
        resultText = "النتيجة: **تعادل**";
      } else {
        return replyEmbed(
          interaction,
          makeEmbed("❌ نتيجة غير صالحة", "اختار فوز الفريق الأول أو الثاني أو التعادل.")
        );
      }

      team1.balance += team1Reward;
      team2.balance += team2Reward;

      db.matches[matchKey] = {
        name: matchName,
        team1: team1.name,
        team2: team2.name,
        result,
        team1Reward,
        team2Reward,
        mvpPaid: false,
        createdAt: Date.now()
      };

      recordTransaction(
        "match-reward",
        `${matchName}: ${team1.name} / ${team2.name}`,
        team1Reward + team2Reward
      );

      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "⚽ تم تسجيل نتيجة المباراة",
          `المباراة: **${matchName}**\n` +
          `${team1.name}: **${money(team1Reward)}**\n` +
          `${team2.name}: **${money(team2Reward)}**\n` +
          `${resultText}\n\n` +
          `رصيد ${team1.name}: **${money(team1.balance)}**\n` +
          `رصيد ${team2.name}: **${money(team2.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- SET MVP ----------

    if (command === "set-mvp") {
      if (!(await adminOnly(interaction))) return;

      const matchName = interaction.options.getString("match");
      const playerName = interaction.options.getString("player");
      const teamName = interaction.options.getString("team");

      const match = db.matches[normalize(matchName)];

      if (!match) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ المباراة غير موجودة",
            "سجّل نتيجة المباراة أولاً باستعمال `/match-reward`."
          )
        );
      }

      if (match.mvpPaid) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ تم صرف مكافأة MVP",
            "تم صرف مكافأة أفضل لاعب في هذه المباراة من قبل."
          )
        );
      }

      const teamKey = normalize(teamName);
      const team1Key = normalize(match.team1);
      const team2Key = normalize(match.team2);

      if (teamKey !== team1Key && teamKey !== team2Key) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "❌ الفريق غير مطابق",
            `الفريق خاصو يكون **${match.team1}** أو **${match.team2}**.`
          )
        );
      }

      let mvpAmount;

      if (match.result === "draw") {
        mvpAmount = 30000;
      } else if (
        (match.result === "team1" && teamKey === team1Key) ||
        (match.result === "team2" && teamKey === team2Key)
      ) {
        mvpAmount = 50000;
      } else {
        mvpAmount = 20000;
      }

      const player = getPlayer(playerName);

      player.balance += mvpAmount;

      match.mvpPaid = true;
      match.mvpPlayer = player.name;
      match.mvpTeam = teamName;
      match.mvpAmount = mvpAmount;

      recordTransaction(
        "match-mvp",
        `${match.name}: ${player.name}`,
        mvpAmount
      );

      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "⭐ تم تحديد أفضل لاعب",
          `المباراة: **${match.name}**\n` +
          `اللاعب: **${player.name}**\n` +
          `الفريق: **${teamName}**\n` +
          `مكافأة MVP: **${money(mvpAmount)}**\n` +
          `الرصيد الجديد: **${money(player.balance)}**`,
          COLORS.green
        )
      );
    }

    // ---------- TEAM BALANCE ----------

    if (command === "team-balance") {
      const name = interaction.options.getString("team");
      const team = db.teams[normalize(name)];

      if (!team) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "🏆 الفريق غير موجود",
            "مازال ما تسجلش رصيد هذا الفريق."
          )
        );
      }

      return replyEmbed(
        interaction,
        makeEmbed(
          "🏆 رصيد الفريق",
          `الفريق: **${team.name}**\n` +
          `الرئيس: **${team.president}**\n` +
          `الرصيد: **${money(team.balance)}**`
        ),
        false
      );
    }

    // ---------- PLAYER BALANCE ----------

    if (command === "player-balance") {
      const name = interaction.options.getString("player");
      const player = db.players[normalize(name)];

      if (!player) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "👤 اللاعب غير موجود",
            "مازال ما تسجلش رصيد هذا اللاعب."
          )
        );
      }

      return replyEmbed(
        interaction,
        makeEmbed(
          "👤 رصيد اللاعب",
          `اللاعب: **${player.name}**\n` +
          `الرصيد: **${money(player.balance)}**`
        ),
        false
      );
    }

    // ---------- COMPANY BALANCE ----------

    if (command === "company-balance") {
      const name = interaction.options.getString("company");
      const company = getCompany(name);

      if (!company) {
        return replyEmbed(
          interaction,
          makeEmbed(
            "🏢 الشركة غير موجودة",
            "تأكد من اسم الشركة."
          )
        );
      }

      accrueCompanyProfit(company);
      saveDatabase();

      return replyEmbed(
        interaction,
        makeEmbed(
          "🏢 رصيد الشركة",
          `الشركة: **${company.name}**\n` +
          `المالك: **${company.owner}**\n` +
          `الرصيد: **${money(company.balance)}**\n` +
          `الربح اليومي: **${money(company.dailyProfit)}**\n` +
          `أقصى رعاية: **${money(company.maxSponsorship)}**`
        ),
        false
      );
    }

    // ---------- MATCH REWARD RULES ----------

    if (command === "rewards-match") {
      return replyEmbed(
        interaction,
        makeEmbed(
          "⚽ قوانين مكافآت المباريات",
          "**🏆 الفريق الفائز:** $100,000\n" +
          "**🤝 كل فريق في حالة التعادل:** $50,000\n" +
          "**❌ الفريق الخاسر:** $0\n\n" +
          "**⭐ مكافأة أفضل لاعب (MVP):**\n" +
          "الفوز: $50,000\n" +
          "التعادل: $30,000\n" +
          "الخسارة: $20,000\n\n" +
          "لا توجد مكافآت إضافية على الأهداف."
        ),
        false
      );
    }

  } catch (error) {
    console.error(`Error in /${command}:`, error);

    const embed = makeEmbed(
      "❌ وقع خطأ",
      "وقع مشكل أثناء تنفيذ الأمر. راجع Console لمعرفة التفاصيل."
    );

    try {
      await replyEmbed(interaction, embed);
    } catch (replyError) {
      console.error("Could not send error response:", replyError);
    }
  }
});

// ==================== PROCESS ERRORS ====================

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ==================== START BOT ====================

client.login(TOKEN);
                                  

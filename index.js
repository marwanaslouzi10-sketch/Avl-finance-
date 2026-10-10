
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

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const ADMIN_ROLE_ID = process.env.AVL_ADMIN_ROLE_ID || "";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID.");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_DATA = {
  players: {},
  teams: {},
  companies: {},
  matches: {},
  dailyRewards: {},
  transactions: []
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(DEFAULT_DATA, null, 2)
      );
    }

    return {
      ...structuredClone(DEFAULT_DATA),
      ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    };
  } catch (error) {
    console.error("Data loading error:", error);
    process.exit(1);
  }
}

let db = loadData();

function saveData() {
  const temporaryFile = DATA_FILE + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(db, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

const money = value =>
  "$" + Math.round(Number(value) || 0).toLocaleString("en-US");

const normalize = value => String(value || "").trim().toLowerCase();

function createEmbed(title, description = "") {
  return new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle(`『💰』 AVL FINANCE`)
    .setDescription(`**${title}**\n${description}`)
    .setFooter({ text: "AVL • Official Finance System" })
    .setTimestamp();
}

function addFields(embed, rows) {
  for (const [name, value] of rows) {
    embed.addFields({
      name: String(name).slice(0, 256),
      value: String(value).slice(0, 1024) || "—",
      inline: true
    });
  }
  return embed;
}

function getPlayer(name) {
  const id = normalize(name);
  if (!db.players[id]) {
    db.players[id] = {
      name: String(name).trim(),
      balance: 0,
      team: ""
    };
  }
  return db.players[id];
}

function getTeam(name) {
  const id = normalize(name);
  if (!db.teams[id]) {
    db.teams[id] = {
      name: String(name).trim(),
      president: "",
      balance: 0
    };
  }
  return db.teams[id];
}

function isAdmin(interaction) {
  if (
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  ) return true;

  if (
    ADMIN_ROLE_ID &&
    interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID)
  ) return true;

  return false;
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  await interaction.reply({
    content: "⛔ هاد الأمر خاص بالإدارة فقط.",
    ephemeral: true
  });

  return false;
}

function logTransaction(type, target, amount, actor, details = "") {
  db.transactions.unshift({
    type,
    target,
    amount,
    actor,
    details,
    date: new Date().toISOString()
  });

  db.transactions = db.transactions.slice(0, 1000);
}

function companyRules(price) {
  if (price >= 3000000 && price < 3500000) {
    return { dailyIncome: 500000, maxContract: 200000 };
  }

  if (price >= 3500000 && price <= 4000000) {
    return { dailyIncome: 700000, maxContract: 300000 };
  }

  return null;
}

function accrueCompany(company) {
  const now = Date.now();
  const last = Number(company.lastAccrualAt || now);
  const elapsedDays = Math.floor((now - last) / 86400000);

  if (elapsedDays > 0) {
    company.balance += elapsedDays * company.dailyIncome;
    company.lastAccrualAt = last + elapsedDays * 86400000;
  }
}

const amountOption = (name = "amount", description = "المبلغ") =>
  option => option
    .setName(name)
    .setDescription(description)
    .setRequired(true)
    .setMinValue(1);

const commands = [
  new SlashCommandBuilder()
    .setName("reward")
    .setDescription("الحصول على المكافأة اليومية"),

  new SlashCommandBuilder()
    .setName("give-money")
    .setDescription("إرسال المال إلى لاعب")
    .addStringOption(o =>
      o.setName("player").setDescription("اسم اللاعب").setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount").setDescription("المبلغ بالدولار").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("give-to-team")
    .setDescription("إضافة المال إلى رصيد فريق")
    .addStringOption(o =>
      o.setName("team").setDescription("اسم الفريق").setRequired(true))
    .addStringOption(o =>
      o.setName("president").setDescription("اسم رئيس الفريق").setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount").setDescription("المبلغ بالدولار").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("give-to-player")
    .setDescription("إضافة المال للاعب داخل فريقه")
    .addStringOption(o =>
      o.setName("player").setDescription("اسم اللاعب").setRequired(true))
    .addStringOption(o =>
      o.setName("team").setDescription("اسم الفريق").setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount").setDescription("المبلغ بالدولار").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("create-company")
    .setDescription("إنشاء شركة جديدة")
    .addStringOption(o =>
      o.setName("company-name").setDescription("اسم الشركة").setRequired(true))
    .addIntegerOption(o =>
      o.setName("purchase-price").setDescription("ثمن شراء الشركة").setRequired(true)
        .setMinValue(3000000).setMaxValue(4000000)),

  new SlashCommandBuilder()
    .setName("view-all-companies")
    .setDescription("عرض جميع الشركات ومعلوماتها"),

  new SlashCommandBuilder()
    .setName("contracting-with-company")
    .setDescription("تسجيل عقد رعاية مع شركة")
    .addStringOption(o =>
      o.setName("company").setDescription("اسم الشركة").setRequired(true))
    .addStringOption(o =>
      o.setName("team").setDescription("اسم الفريق").setRequired(true))
    .addIntegerOption(o =>
      o.setName("amount").setDescription("مبلغ العقد بالدولار").setRequired(true)
        .addChoices(
          { name: "$50,000", value: 50000 },
          { name: "$100,000", value: 100000 },
          { name: "$150,000", value: 150000 },
          { name: "$200,000", value: 200000 },
          { name: "$250,000", value: 250000 },
          { name: "$300,000", value: 300000 }
        )),

  new SlashCommandBuilder()
    .setName("match-reward")
    .setDescription("تسجيل نتيجة المباراة وصرف مكافآت الفريقين")
    .addStringOption(o =>
      o.setName("match").setDescription("اسم المباراة أو رقمها").setRequired(true))
    .addStringOption(o =>
      o.setName("team-1").setDescription("اسم الفريق الأول").setRequired(true))
    .addStringOption(o =>
      o.setName("team-2").setDescription("اسم الفريق الثاني").setRequired(true))
    .addStringOption(o =>
      o.setName("result").setDescription("نتيجة المباراة").setRequired(true)
        .addChoices(
          { name: "فوز الفريق الأول", value: "team1" },
          { name: "فوز الفريق الثاني", value: "team2" },
          { name: "تعادل", value: "draw" }
        )),

  new SlashCommandBuilder()
    .setName("set-mvp")
    .setDescription("تحديد أفضل لاعب في المباراة")
    .addStringOption(o =>
      o.setName("match").setDescription("اسم المباراة أو رقمها").setRequired(true))
    .addStringOption(o =>
      o.setName("player").setDescription("اسم اللاعب").setRequired(true))
    .addStringOption(o =>
      o.setName("team").setDescription("فريق اللاعب").setRequired(true)),

  new SlashCommandBuilder()
    .setName("team-balance")
    .setDescription("عرض رصيد الفريق")
    .addStringOption(o =>
      o.setName("team").setDescription("اسم الفريق").setRequired(true)),

  new SlashCommandBuilder()
    .setName("player-balance")
    .setDescription("عرض رصيد اللاعب")
    .addStringOption(o =>
      o.setName("player").setDescription("اسم اللاعب").setRequired(true)),

  new SlashCommandBuilder()
    .setName("company-balance")
    .setDescription("عرض رصيد الشركة")
    .addStringOption(o =>
      o.setName("company").setDescription("اسم الشركة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("rewards-match")
    .setDescription("عرض قوانين مكافآت المباريات")
].map(command => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function handleCommand(interaction) {
  const command = interaction.commandName;

  if ([
    "give-money",
    "give-to-team",
    "give-to-player",
    "create-company",
    "contracting-with-company",
    "match-reward",
    "set-mvp"
  ].includes(command)) {
    if (!(await requireAdmin(interaction))) return;
  }

  if (command === "reward") {
    const id = interaction.user.id;
    const last = Number(db.dailyRewards[id] || 0);
    const remaining = 86400000 - (Date.now() - last);

    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.ceil((remaining % 3600000) / 60000);

      return interaction.reply({
        embeds: [createEmbed(
          "⏳ المكافأة اليومية",
          `لقد حصلت على مكافأتك بالفعل.\nيمكنك العودة بعد **${hours} ساعة و${minutes} دقيقة**.`
        )],
        ephemeral: true
      });
    }

    const player = getPlayer(interaction.user.username);
    player.balance += 20;
    db.dailyRewards[id] = Date.now();

    logTransaction("Daily reward", player.name, 20, interaction.user.tag);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🎁 المكافأة اليومية", "تمت إضافة مكافأتك بنجاح!"), [
        ["👤 اللاعب", player.name],
        ["💵 المكافأة", money(20)],
        ["💰 الرصيد الجديد", money(player.balance)]
      ])]
    });
  }

  if (command === "give-money") {
    const name = interaction.options.getString("player");
    const amount = interaction.options.getInteger("amount");
    const player = getPlayer(name);
    player.balance += amount;

    logTransaction("Give money", player.name, amount, interaction.user.tag);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("💸 تحويل مالي", "تمت إضافة المبلغ للاعب."), [
        ["👤 اللاعب", player.name],
        ["💵 المبلغ", money(amount)],
        ["💰 الرصيد الجديد", money(player.balance)]
      ])]
    });
  }

  if (command === "give-to-team") {
    const name = interaction.options.getString("team");
    const president = interaction.options.getString("president");
    const amount = interaction.options.getInteger("amount");
    const team = getTeam(name);

    team.president = president;
    team.balance += amount;

    logTransaction("Give to team", team.name, amount, interaction.user.tag, president);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🏆 تمويل فريق", "تم تحديث رصيد الفريق بنجاح."), [
        ["⚽ الفريق", team.name],
        ["👔 الرئيس", president],
        ["💵 المبلغ", money(amount)],
        ["💰 الرصيد الجديد", money(team.balance)]
      ])]
    });
  }

  if (command === "give-to-player") {
    const name = interaction.options.getString("player");
    const teamName = interaction.options.getString("team");
    const amount = interaction.options.getInteger("amount");
    const player = getPlayer(name);

    player.team = teamName;
    player.balance += amount;

    logTransaction("Give to player", player.name, amount, interaction.user.tag, teamName);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("👤 مكافأة لاعب", "تم تحديث رصيد اللاعب."), [
        ["👤 اللاعب", player.name],
        ["⚽ الفريق", teamName],
        ["💵 المبلغ", money(amount)],
        ["💰 الرصيد الجديد", money(player.balance)]
      ])]
    });
  }

  if (command === "create-company") {
    const name = interaction.options.getString("company-name").trim();
    const price = interaction.options.getInteger("purchase-price");
    const id = normalize(name);

    if (db.companies[id]) {
      return interaction.reply({
        content: "⚠️ كاينة شركة بهاد الاسم من قبل.",
        ephemeral: true
      });
    }

    const rules = companyRules(price);
    if (!rules) {
      return interaction.reply({
        content: "❌ ثمن الشركة خاصو يكون بين $3,000,000 و$4,000,000.",
        ephemeral: true
      });
    }

    db.companies[id] = {
      name,
      owner: interaction.user.tag,
      purchasePrice: price,
      balance: 0,
      dailyIncome: rules.dailyIncome,
      maxContract: rules.maxContract,
      lastAccrualAt: Date.now(),
      contracts: []
    };

    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🏢 تم إنشاء الشركة", "تم تسجيل الشركة في نظام AVL Finance."), [
        ["🏢 الشركة", name],
        ["👤 المالك", interaction.user.tag],
        ["💳 ثمن الشراء", money(price)],
        ["📈 الأرباح اليومية", money(rules.dailyIncome)],
        ["🤝 الحد الأقصى للرعاية", money(rules.maxContract)]
      ])]
    });
  }

  if (command === "view-all-companies") {
    const companies = Object.values(db.companies);

    for (const company of companies) accrueCompany(company);
    saveData();

    if (!companies.length) {
      return interaction.reply({
        embeds: [createEmbed("🏢 الشركات", "مازال ما تسجلات حتى شركة.")]
      });
    }

    const embed = createEmbed("🏢 قائمة الشركات", `عدد الشركات: **${companies.length}**`);

    for (const company of companies.slice(0, 25)) {
      embed.addFields({
        name: `🏢 ${company.name}`,
        value:
          `👤 المالك: ${company.owner}\n` +
          `💰 الرصيد: ${money(company.balance)}\n` +
          `📈 الأرباح اليومية: ${money(company.dailyIncome)}\n` +
          `🤝 أقصى رعاية: ${money(company.maxContract)}`,
        inline: false
      });
    }

    return interaction.reply({ embeds: [embed] });
  }

  if (command === "contracting-with-company") {
    const companyName = interaction.options.getString("company");
    const teamName = interaction.options.getString("team");
    const amount = interaction.options.getInteger("amount");
    const company = db.companies[normalize(companyName)];

    if (!company) {
      return interaction.reply({
        content: "❌ هاد الشركة ما كايناش فالسجل.",
        ephemeral: true
      });
    }

    accrueCompany(company);

    if (amount > company.maxContract) {
      return interaction.reply({
        content: `❌ الحد الأقصى لرعاية هاد الشركة هو ${money(company.maxContract)}.`,
        ephemeral: true
      });
    }

    const team = getTeam(teamName);
    company.balance -= amount;
    team.balance += amount;

    company.contracts.push({
      team: team.name,
      amount,
      date: new Date().toISOString()
    });

    logTransaction("Company sponsorship", company.name, amount, interaction.user.tag, team.name);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🤝 عقد رعاية", "تم تسجيل العقد وتحويل المبلغ."), [
        ["🏢 الشركة", company.name],
        ["⚽ الفريق", team.name],
        ["💵 مبلغ العقد", money(amount)],
        ["💰 رصيد الشركة", money(company.balance)],
        ["🏆 رصيد الفريق", money(team.balance)]
      ])]
    });
  }

  if (command === "match-reward") {
    const matchName = interaction.options.getString("match").trim();
    const team1Name = interaction.options.getString("team-1").trim();
    const team2Name = interaction.options.getString("team-2").trim();
    const result = interaction.options.getString("result");
    const matchId = normalize(matchName);

    if (normalize(team1Name) === normalize(team2Name)) {
      return interaction.reply({
        content: "❌ خاصك تدخل جوج فرق مختلفين.",
        ephemeral: true
      });
    }

    if (db.matches[matchId]) {
      return interaction.reply({
        content: "⚠️ هاد المباراة مسجلة من قبل. ما يمكنش تصرف المكافأة مرتين.",
        ephemeral: true
      });
    }

    const team1 = getTeam(team1Name);
    const team2 = getTeam(team2Name);
    let reward1 = 0;
    let reward2 = 0;
    let resultText = "";

    if (result === "team1") {
      reward1 = 100000;
      resultText = `🏆 الفائز: ${team1.name}`;
    } else if (result === "team2") {
      reward2 = 100000;
      resultText = `🏆 الفائز: ${team2.name}`;
    } else {
      reward1 = 50000;
      reward2 = 50000;
      resultText = "🤝 انتهت المباراة بالتعادل";
    }

    team1.balance += reward1;
    team2.balance += reward2;

    db.matches[matchId] = {
      name: matchName,
      team1: team1.name,
      team2: team2.name,
      result,
      reward1,
      reward2,
      mvpSet: false,
      date: new Date().toISOString()
    };

    logTransaction("Match reward", team1.name, reward1, interaction.user.tag, matchName);
    logTransaction("Match reward", team2.name, reward2, interaction.user.tag, matchName);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("⚽ مكافآت المباراة", resultText), [
        ["🏟️ المباراة", matchName],
        ["📊 النتيجة", result === "draw" ? "تعادل" : "تم تسجيل الفوز"],
        [`⚽ ${team1.name}`, money(reward1)],
        [`⚽ ${team2.name}`, money(reward2)],
        ["💰 رصيد الفريق الأول", money(team1.balance)],
        ["💰 رصيد الفريق الثاني", money(team2.balance)]
      ])]
    });
  }

  if (command === "set-mvp") {
    const matchName = interaction.options.getString("match").trim();
    const playerName = interaction.options.getString("player").trim();
    const teamName = interaction.options.getString("team").trim();
    const match = db.matches[normalize(matchName)];

    if (!match) {
      return interaction.reply({
        content: "❌ المباراة ما مسجلةش. استعمل /match-reward أولاً.",
        ephemeral: true
      });
    }

    if (match.mvpSet) {
      return interaction.reply({
        content: "⚠️ تم صرف مكافأة MVP لهاد المباراة من قبل.",
        ephemeral: true
      });
    }

    if (
      normalize(teamName) !== normalize(match.team1) &&
      normalize(teamName) !== normalize(match.team2)
    ) {
      return interaction.reply({
        content: "❌ فريق اللاعب ما مشاركش فهاد المباراة.",
        ephemeral: true
      });
    }

    const mvpReward = match.result === "draw"
      ? 30000
      : ((match.result === "team1" && normalize(teamName) === normalize(match.team1)) ||
         (match.result === "team2" && normalize(teamName) === normalize(match.team2)))
        ? 50000
        : 20000;

    const player = getPlayer(playerName);
    player.team = teamName;
    player.balance += mvpReward;
    match.mvpSet = true;
    match.mvp = playerName;
    match.mvpReward = mvpReward;

    logTransaction("MVP reward", player.name, mvpReward, interaction.user.tag, matchName);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("⭐ أفضل لاعب في المباراة", "تم تسجيل MVP وصرف المكافأة."), [
        ["🏟️ المباراة", match.name],
        ["⭐ اللاعب", player.name],
        ["⚽ الفريق", teamName],
        ["💵 مكافأة MVP", money(mvpReward)],
        ["💰 رصيد اللاعب", money(player.balance)]
      ])]
    });
  }

  if (command === "team-balance") {
    const name = interaction.options.getString("team");
    const team = getTeam(name);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🏆 رصيد الفريق"), [
        ["⚽ الفريق", team.name],
        ["👔 الرئيس", team.president || "غير مسجل"],
        ["💰 الرصيد", money(team.balance)]
      ])]
    });
  }

  if (command === "player-balance") {
    const name = interaction.options.getString("player");
    const player = getPlayer(name);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("👤 رصيد اللاعب"), [
        ["👤 اللاعب", player.name],
        ["⚽ الفريق", player.team || "غير مسجل"],
        ["💰 الرصيد", money(player.balance)]
      ])]
    });
  }

  if (command === "company-balance") {
    const name = interaction.options.getString("company");
    const company = db.companies[normalize(name)];

    if (!company) {
      return interaction.reply({
        content: "❌ الشركة غير موجودة.",
        ephemeral: true
      });
    }

    accrueCompany(company);
    saveData();

    return interaction.reply({
      embeds: [addFields(createEmbed("🏢 رصيد الشركة"), [
        ["🏢 الشركة", company.name],
        ["👤 المالك", company.owner],
        ["💰 الرصيد", money(company.balance)],
        ["📈 الأرباح اليومية", money(company.dailyIncome)],
        ["🤝 أقصى رعاية", money(company.maxContract)]
      ])]
    });
  }

  if (command === "rewards-match") {
    const embed = createEmbed(
      "⚽ قوانين مكافآت المباريات",
      "القوانين الرسمية لمكافآت AVL Finance"
    );

    embed.addFields(
      { name: "🏆 فوز الفريق", value: money(100000), inline: true },
      { name: "🤝 تعادل كل فريق", value: money(50000), inline: true },
      { name: "❌ الفريق الخاسر", value: money(0), inline: true },
      { name: "⭐ MVP عند الفوز", value: money(50000), inline: true },
      { name: "⭐ MVP عند التعادل", value: money(30000), inline: true },
      { name: "⭐ MVP عند الخسارة", value: money(20000), inline: true }
    );

    embed.addFields({
      name: "📌 ملاحظة",
      value: "لا توجد مكافآت إضافية على الأهداف."
    });

    return interaction.reply({ embeds: [embed] });
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log("Slash commands registered for the configured server.");
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log("Global slash commands registered. They may take time to appear.");
    }
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`Command error (${interaction.commandName}):`, error);

    const reply = {
      content: "❌ وقع خطأ أثناء تنفيذ الأمر. راجع إعدادات البوت والبيانات.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

client.login(TOKEN);

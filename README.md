
# 『💰』AVL Finance Bot

Official finance bot for the Arabic Virtual League (AVL).

## Requirements
- Node.js 20 or newer
- A Discord application and bot
- The bot invited with the `bot` and `applications.commands` scopes

## Commands
- `/reward`
- `/give-money`
- `/give-to-team`
- `/give-to-player`
- `/create-company`
- `/view-all-companies`
- `/contracting-with-company`
- `/match-reward`
- `/set-mvp`
- `/team-balance`
- `/player-balance`
- `/company-balance`
- `/rewards-match`

## Environment variables
Configure these in your hosting provider's Secrets or Environment settings:

- `DISCORD_BOT_TOKEN` — Discord bot token
- `DISCORD_CLIENT_ID` — Discord application ID
- `DISCORD_GUILD_ID` — optional server ID for immediate guild command registration
- `AVL_ADMIN_ROLE_ID` — optional role ID allowed to use administrative commands

Never commit your real bot token to GitHub.

## Run
```bash
npm install
npm start
```

## Finance rules
- Winning team: $100,000
- Each team in a draw: $50,000
- Losing team: $0
- MVP in a win: $50,000
- MVP in a draw: $30,000
- MVP in a loss: $20,000
- Daily reward: $20 every 24 hours
- No goal bonuses

## Data
The bot stores balances, companies, matches, daily rewards, and transaction records in `data.json`.
Keep this file persistent when deploying the bot.

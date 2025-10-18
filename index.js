require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ===== Web server to keep bot alive (Render requirement) =====
const app = express();
app.get('/', (req, res) => res.send('TEP Bot is running'));
app.listen(3000, () => console.log('Web server started on port 3000'));

// ===== Supabase setup =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
  const { data, error } = await supabase.from('users').select('*');
  if (error) console.error('❌ Supabase error:', error);
  else console.log('✅ Supabase connected');
})();

// ===== Discord client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ===== Slash commands =====
const commands = [
  new SlashCommandBuilder().setName('join').setDescription('Join the TEP program'),
  new SlashCommandBuilder().setName('proof').setDescription('Submit payment proof'),
  new SlashCommandBuilder().setName('progress').setDescription('Check your TEP progress')
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationCommands(process.env.BOT_CLIENT_ID), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (err) {
    console.error(err);
  }
})();

// ===== Helper functions =====
async function createUser(discordId, username) {
  // Check if user exists
  const { data: existing } = await supabase.from('users').select('*').eq('discord_id', discordId).single();
  if (existing) return { error: 'You are already in the program.' };

  const { data, error } = await supabase.from('users').insert({
    discord_id: discordId,
    username,
    level: 1,
    phase: 1,
    earnings: 0,
    created_at: new Date()
  }).select().single();
  return { data, error };
}

async function getUser(discordId) {
  const { data, error } = await supabase.from('users').select('*').eq('discord_id', discordId).single();
  return { data, error };
}

async function addPayment(senderId, receiverId, amount, level, txid) {
  const { data, error } = await supabase.from('payments').insert({
    id: uuidv4(),
    sender_id: senderId,
    receiver_id: receiverId,
    amount,
    level,
    txid,
    confirmed: false,
    created_at: new Date()
  }).select().single();
  return { data, error };
}

// ===== Discord interactions =====
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'join') {
    const { data, error } = await createUser(interaction.user.id, interaction.user.username);
    if (error) return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
    interaction.reply({ content: '✅ You joined the TEP program!', ephemeral: true });
  }

  if (commandName === 'progress') {
    const { data, error } = await getUser(interaction.user.id);
    if (error || !data) return interaction.reply({ content: '❌ You are not in the program.', ephemeral: true });
    interaction.reply({ content: `📊 Level: ${data.level}, Phase: ${data.phase}, Earnings: ${data.earnings}`, ephemeral: true });
  }

  if (commandName === 'proof') {
    // In real implementation, you would capture txid, amount, and receiver
    interaction.reply({ content: '✅ Payment proof submitted! Your upline will be notified.', ephemeral: true });
    // Notify upline (simplified example)
    const { data: user } = await getUser(interaction.user.id);
    if (user && user.upline_id) {
      const { data: upline } = await getUser(user.upline_id);
      if (upline) {
        try {
          const dm = await client.users.fetch(upline.discord_id);
          dm.send(`💰 Payment proof received from ${interaction.user.username} for Level ${user.level}.`);
        } catch (err) {
          console.log('❌ Could not DM upline:', err);
        }
      }
    }
  }

  // ===== Additional logic =====
  // Level 5 admin fee unlock
  // Example: if user.level === 5 && earnings >= 66% of level5 target
  // Prompt to pay admin fee and unlock remaining earnings
});

// ===== Login =====
client.login(process.env.TOKEN);

require('dotenv').config();
const app = require("./src/app");

// DB is now handled inside src/app.js — no need to connect here

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
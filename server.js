require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { exec } = require('child_process'); 

const swaggerUI = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const authRoutes = require("./src/routes/auth.routes");
const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec));

app.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("DB connection failed", err);
  } else {
    console.log("DB connected:", res.rows[0]);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  
  console.log(`✅ Server running at ${url}`);
  console.log(`📚 Swagger UI: ${url}/api-docs`);
  

  const command = process.platform === 'win32' 
    ? `start ${url}/api-docs` 
    : process.platform === 'darwin' 
      ? `open ${url}/api-docs` 
      : `xdg-open ${url}/api-docs`;
  
  exec(command, (error) => {
    if (error) {
      console.log('⚠️  Could not open browser. Please visit manually:', `${url}/api-docs`);
    }
  });
});
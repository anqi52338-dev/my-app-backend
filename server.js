const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: '服务正常运行 🚀' });
});

app.listen(port, () => {
  console.log(`后端服务已启动: http://localhost:${port}`);
});
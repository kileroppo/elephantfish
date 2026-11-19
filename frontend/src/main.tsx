import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// 导入顺序即契约：tokens.css 是全站唯一色值/字体栈/缓动来源；tw.css 的
// @theme inline 全部桥接到这里的变量（bg-paper-* 等 utility 运行期解析
// var(--paper-*)），必须先加载；app.css 及其模块是无层存量样式，按层叠
// 纪律压在 tw 的 layer(utilities) 之上。调换顺序会让工具类静默失效。
import './styles/tokens.css'
import './styles/tw.css'
import './styles/app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

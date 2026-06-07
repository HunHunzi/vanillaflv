const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/Player.js', // 项目入口文件
  output: {
    filename: 'bundle.js', // 打包后的文件名
    path: path.resolve(__dirname, 'dist'), // 输出目录（必须是绝对路径）
    library: 'VanillaFLV', // 暴露为全局变量
    libraryTarget: 'umd', // 支持多种模块系统 (AMD, CommonJS, 全局变量)
    clean: true, // 每次打包清理 dist 目录
  },
  mode: 'development', // 默认是开发模式（development / production）
  devtool: 'inline-source-map', // 方便调试的 source map
  devServer: {
    static: './dist', // 开发服务器的根目录
    port: 8080, // 开发服务器端口
    open: true, // 自动打开浏览器
  },
  module: {
    rules: [
      {
        test: /\.css$/, // 匹配 .css 文件
        use: ['style-loader', 'css-loader'], // 使用 CSS 加载器
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/i, // 匹配图片文件
        type: 'asset/resource', // 处理图片资源
      },
      {
        test: /\.js$/, // 匹配 .js 文件
        exclude: /node_modules/, // 排除 node_modules 目录
        use: {
          loader: 'babel-loader', // 使用 Babel 加载器
          options: {
            presets: ['@babel/preset-env'], // 转换 ES6+ 代码
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html', // 以指定的 HTML 文件为模板
    }),
  ],
};

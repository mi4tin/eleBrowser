对于显示对话框：
1、 will-download事件 > 应用失去焦点 > updated事件，则说明对话窗口弹出
2、对话弹出后， 应用窗口获取焦点， done事件的state为cancelled，则说明点了取消，如果一直没有触发done事件或者state不是cancelled，则说明点了保存




==bug==
+运行，处理报错


==基本==
//设置对话弹窗的默认路径和标题
const opts = { defaultPath: suggested, title: '另存为' };
dialog.showSaveDialog(opts)
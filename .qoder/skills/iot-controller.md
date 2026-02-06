# IoT Controller Skill

物联网设备控制技能。

## 功能说明
- 控制智能家居设备
- 管理IoT设备连接
- 自动化场景设置

## 使用方法
在聊天中输入：
- `/iot` - 打开IoT控制面板
- `/devices` - 显示连接的设备列表
- `/control-device light on` - 控制设备开关
- `/scenes` - 显示自动化场景

## 设备管理
- `/add-device` - 添加新设备
- `/remove-device device-id` - 移除设备
- `/device-status device-id` - 查看设备状态
- `/group-devices living-room` - 设备分组

## 自动化
- `/create-scene` - 创建自动化场景
- `/schedule-device time action` - 定时控制设备
- `/trigger-condition` - 设置触发条件
- `/energy-usage` - 能耗统计

## 实现原理
通过IoT协议和智能家居API实现设备发现、控制和自动化管理。
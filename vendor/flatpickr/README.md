# flatpickr 4.6.13

来财Lai 的日期、月份选择用的开源日历组件（MIT，见 LICENSE）。官网 https://flatpickr.js.org ，来源 npm 包 `flatpickr@4.6.13`，文件原样复制，没有改动：

| 文件 | 来自 |
| --- | --- |
| flatpickr.min.js、flatpickr.min.css | dist/ |
| l10n-zh.js | dist/l10n/zh.js（简体中文：星期、月份、「上个月」等） |
| monthSelect.js、monthSelect.css | dist/plugins/monthSelect/（选月份用） |

SHA-256：

```
1eeab1cb779471a0b0aaa93dd91c2eb1aa537d696f01ab05ea9dabc55e8525a1  flatpickr.min.js
1b34a42552c96f10e4dfaaa4a367276b03868aacff63c1ac42ffe331352bc754  flatpickr.min.css
8629568c4e6c9536864189e9434195416ab5b2d63c9793a3779f12a5b34d9955  l10n-zh.js
07782c68d4ee9a21c122227cc5228bbee134517ea0c99f1577af3f014746633e  monthSelect.js
d6b99c057e2222a7c279c81caced0fcf6bdf2fd44aa402b81ade6c1d2a19a10a  monthSelect.css
5fd57afc3905651175947ae44818e91ffcf5b605e4c88fac42d9700243bd9095  LICENSE
```

构建时由 scripts/build.py 直接内联进单页（不需要单独的 vendor 路由，网页试用版同理）。接线在 src/date-picker.js，样式在 src/date-picker.css。

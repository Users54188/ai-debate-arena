App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("CloudBase SDK not available, check base library version.");
    } else {
      wx.cloud.init({
        env: "<云开发环境ID>",
        traceUser: true,
      });
    }
    const sysInfo = wx.getSystemInfoSync();
    const sdkVersion = sysInfo.SDKVersion;
    console.log(`SDKVersion: ${sdkVersion}`);
    const requiredVersion = "3.7.1"; // wx.cloud.extend.AI 最低要求（来源：腾讯云开发接入指引）
    if (this.compareVersion(sdkVersion, requiredVersion) < 0) {
      wx.showModal({
        title: "版本过低",
        content: `当前微信版本过低，请升级至基础库 ${requiredVersion} 以上以使用 AI 功能。当前版本：${sdkVersion}`,
        showCancel: false,
      });
    }
  },

  compareVersion(v1, v2) {
    const a = v1.split(".").map(Number);
    const b = v2.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  },
});

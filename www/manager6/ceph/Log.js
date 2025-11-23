Ext.define('PVE.ceph.Log', {
    extend: 'Proxmox.panel.LogView',
    xtype: 'cephLogView',

    nodename: undefined,

    failCallback: function (response) {
        var me = this;
        var msg = response.htmlStatus;
        var windowShow = PVE.Utils.showCephInstallOrMask(me, msg, me.nodename, function (win) {
            me.mon(win, 'cephInstallWindowClosed', function () {
                me.loadTask.delay(200);
            });
        });
        if (!windowShow) {
            Proxmox.Utils.setErrorMask(me, msg);
        }
    },
});

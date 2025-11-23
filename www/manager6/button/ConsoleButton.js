Ext.define('PVE.button.ConsoleButton', {
    extend: 'Ext.button.Split',
    alias: 'widget.pveConsoleButton',

    consoleType: 'shell', // one of 'shell', 'kvm', 'lxc', 'upgrade', 'cmd'

    cmd: undefined,

    consoleName: undefined,

    iconCls: 'fa fa-terminal',

    enableSpice: true,
    enableXtermjs: true,

    nodename: undefined,

    vmid: 0,

    text: gettext('Console'),

    setEnableSpice: function (enable) {
        var me = this;

        me.enableSpice = enable;
        me.down('#spicemenu').setDisabled(!enable);
    },

    setEnableXtermJS: function (enable) {
        var me = this;

        me.enableXtermjs = enable;
        me.down('#xtermjs').setDisabled(!enable);
    },

    handler: function () {
        // main, general, handler
        let me = this;
        PVE.Utils.openDefaultConsoleWindow(
            {
                spice: me.enableSpice,
                xtermjs: me.enableXtermjs,
            },
            me.consoleType,
            me.vmid,
            me.nodename,
            me.consoleName,
            me.cmd,
        );
    },

    openConsole: function (types) {
        // used by split-menu buttons
        let me = this;
        PVE.Utils.openConsoleWindow(
            types,
            me.consoleType,
            me.vmid,
            me.nodename,
            me.consoleName,
            me.cmd,
        );
    },

    menu: [
        {
            xtype: 'menuitem',
            text: 'noVNC',
            iconCls: 'pve-itype-icon-novnc',
            type: 'html5',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
        {
            xterm: 'menuitem',
            itemId: 'spicemenu',
            text: 'SPICE',
            type: 'vv',
            iconCls: 'pve-itype-icon-virt-viewer',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
        {
            text: 'xterm.js',
            itemId: 'xtermjs',
            iconCls: 'pve-itype-icon-xtermjs',
            type: 'xtermjs',
            handler: function (button) {
                let view = this.up('button');
                view.openConsole(button.type);
            },
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.callParent();
    },
});

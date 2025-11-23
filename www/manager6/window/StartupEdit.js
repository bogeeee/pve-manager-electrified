Ext.define('PVE.panel.StartupInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    onlineHelp: 'qm_startup_and_shutdown',

    onGetValues: function (values) {
        var _me = this;

        var res = PVE.Parser.printStartup(values);

        if (res === undefined || res === '') {
            return { delete: 'startup' };
        }

        return { startup: res };
    },

    setStartup: function (value) {
        var me = this;

        var startup = PVE.Parser.parseStartup(value);
        if (startup) {
            me.setValues(startup);
        }
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'textfield',
                name: 'order',
                defaultValue: '',
                emptyText: 'any',
                fieldLabel: gettext('Start/Shutdown order'),
            },
            {
                xtype: 'textfield',
                name: 'up',
                defaultValue: '',
                emptyText: 'default',
                fieldLabel: gettext('Startup delay'),
            },
            {
                xtype: 'textfield',
                name: 'down',
                defaultValue: '',
                emptyText: 'default',
                fieldLabel: gettext('Shutdown timeout'),
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.window.StartupEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveWindowStartupEdit',
    onlineHelp: undefined,

    initComponent: function () {
        let me = this;

        let ipanelConfig = me.onlineHelp ? { onlineHelp: me.onlineHelp } : {};
        let ipanel = Ext.create('PVE.panel.StartupInputPanel', ipanelConfig);

        Ext.applyIf(me, {
            subject: gettext('Start/Shutdown order'),
            fieldDefaults: {
                labelWidth: 120,
            },
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                me.vmconfig = response.result.data;
                ipanel.setStartup(me.vmconfig.startup);
            },
        });
    },
});

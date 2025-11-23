Ext.define('PVE.sdn.controllers.IsisInputPanel', {
    extend: 'PVE.panel.SDNControllerBase',

    onlineHelp: 'pvesdn_controller_plugin_evpn',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
            values.controller = 'isis' + values.node;
        } else {
            delete values.controller;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'pveNodeSelector',
                name: 'node',
                fieldLabel: gettext('Node'),
                multiSelect: false,
                autoSelect: false,
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'isis-domain',
                fieldLabel: 'Domain',
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'isis-net',
                fieldLabel: 'Network entity title',
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'isis-ifaces',
                fieldLabel: gettext('Interfaces'),
                allowBlank: false,
            },
        ];

        me.advancedItems = [
            {
                xtype: 'textfield',
                name: 'loopback',
                fieldLabel: gettext('Loopback Interface'),
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.sdn.zones.VlanInputPanel', {
    extend: 'PVE.panel.SDNZoneBase',

    onlineHelp: 'pvesdn_zone_plugin_vlan',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.zone;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'textfield',
                name: 'bridge',
                fieldLabel: 'Bridge',
                allowBlank: false,
                vtype: 'BridgeName',
                minLength: 1,
                maxLength: 10,
            },
        ];

        me.callParent();
    },
});

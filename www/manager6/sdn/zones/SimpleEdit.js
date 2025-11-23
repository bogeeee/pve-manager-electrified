Ext.define('PVE.sdn.zones.SimpleInputPanel', {
    extend: 'PVE.panel.SDNZoneBase',

    onlineHelp: 'pvesdn_zone_plugin_simple',

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

        me.items = [];
        me.advancedItems = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'dhcp',
                inputValue: 'dnsmasq',
                uncheckedValue: null,
                checked: false,
                fieldLabel: gettext('automatic DHCP'),
                deleteEmpty: !me.isCreate,
            },
        ];

        me.callParent();
    },
});

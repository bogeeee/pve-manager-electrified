Ext.define('PVE.sdn.zones.VxlanInputPanel', {
    extend: 'PVE.panel.SDNZoneBase',

    onlineHelp: 'pvesdn_zone_plugin_vxlan',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
            delete values.delete;
        } else {
            delete values.zone;

            for (const [key, value] of Object.entries(values)) {
                if (value === null || value === undefined || value === '') {
                    delete values[key];

                    if (values.delete) {
                        if (Array.isArray(values.delete)) {
                            values.delete.push(key);
                        } else {
                            values.delete = [values.delete, key];
                        }
                    } else {
                        values.delete = [key];
                    }
                }
            }
        }

        delete values.mode;

        return values;
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'proxmoxtextfield',
                name: 'peers',
                fieldLabel: gettext('Peer Address List'),
                allowBlank: true,
                deleteEmpty: true,
            },
            {
                xtype: 'proxmoxNetworkSelector',
                name: 'fabric',
                type: 'fabric',
                valueField: 'iface',
                displayField: 'iface',
                fieldLabel: 'SDN Fabric',
                skipEmptyText: true,
                allowBlank: true,
                deleteEmpty: true,
                autoSelect: false,
                emptyText: gettext('used as underlay network'),
                nodename: 'localhost',
                listConfig: {
                    width: 600,
                    columns: [
                        {
                            header: gettext('Fabric'),
                            width: 90,
                            dataIndex: 'iface',
                        },
                        {
                            header: gettext('CIDR'),
                            dataIndex: 'cidr',
                            hideable: false,
                            flex: 1,
                        },
                    ],
                },
            },
        ];

        me.callParent();
    },
});

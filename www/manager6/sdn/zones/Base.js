Ext.define('PVE.panel.SDNZoneBase', {
    extend: 'Proxmox.panel.InputPanel',

    type: '',

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

        me.items.unshift({
            xtype: me.isCreate ? 'textfield' : 'displayfield',
            name: 'zone',
            maxLength: 8,
            value: me.zone || '',
            fieldLabel: 'ID',
            allowBlank: false,
        });

        me.items.push(
            {
                xtype: 'proxmoxintegerfield',
                name: 'mtu',
                minValue: 100,
                maxValue: 65000,
                fieldLabel: 'MTU',
                allowBlank: true,
                emptyText: 'auto',
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'pveNodeSelector',
                name: 'nodes',
                fieldLabel: gettext('Nodes'),
                emptyText: gettext('All') + ' (' + gettext('No restrictions') + ')',
                multiSelect: true,
                autoSelect: false,
            },
            {
                xtype: 'pveSDNIpamSelector',
                fieldLabel: gettext('IPAM'),
                name: 'ipam',
                value: me.ipam || 'pve',
                allowBlank: false,
            },
        );

        me.advancedItems = me.advancedItems ?? [];

        me.advancedItems.unshift(
            {
                xtype: 'pveSDNDnsSelector',
                fieldLabel: gettext('DNS Server'),
                name: 'dns',
                value: '',
                allowBlank: true,
            },
            {
                xtype: 'pveSDNDnsSelector',
                fieldLabel: gettext('Reverse DNS Server'),
                name: 'reversedns',
                value: '',
                allowBlank: true,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'dnszone',
                skipEmptyText: true,
                fieldLabel: gettext('DNS Zone'),
                allowBlank: true,
                deleteEmpty: !me.isCreate,
            },
        );

        me.callParent();
    },
});

Ext.define('PVE.sdn.zones.BaseEdit', {
    extend: 'Proxmox.window.Edit',

    width: 400,

    initComponent: function () {
        var me = this;

        me.isCreate = !me.zone;

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/sdn/zones';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/cluster/sdn/zones/' + me.zone;
            me.method = 'PUT';
        }

        var ipanel = Ext.create(me.paneltype, {
            type: me.type,
            isCreate: me.isCreate,
            zone: me.zone,
        });

        Ext.apply(me, {
            subject: PVE.Utils.format_sdnzone_type(me.type),
            isAdd: true,
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;
                    var ctypes = values.content || '';

                    values.content = ctypes.split(',');

                    if (values.nodes) {
                        values.nodes = values.nodes.split(',');
                    }

                    if (values.exitnodes) {
                        values.exitnodes = values.exitnodes.split(',');
                    }

                    values.enable = values.disable ? 0 : 1;

                    ipanel.setValues(values);
                },
            });
        }
    },
});

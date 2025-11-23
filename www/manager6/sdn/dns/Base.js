Ext.define('PVE.panel.SDNDnsBase', {
    extend: 'Proxmox.panel.InputPanel',

    type: '',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.dns;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.callParent();
    },
});

Ext.define('PVE.sdn.dns.BaseEdit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        me.isCreate = !me.dns;

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/sdn/dns';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/cluster/sdn/dns/' + me.dns;
            me.method = 'PUT';
        }

        var ipanel = Ext.create(me.paneltype, {
            type: me.type,
            isCreate: me.isCreate,
            dns: me.dns,
        });

        Ext.apply(me, {
            subject: PVE.Utils.format_sdndns_type(me.type),
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
                    values.enable = values.disable ? 0 : 1;

                    ipanel.setValues(values);
                },
            });
        }
    },
});

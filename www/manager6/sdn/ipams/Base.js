Ext.define('PVE.panel.SDNIpamBase', {
    extend: 'Proxmox.panel.InputPanel',

    type: '',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        } else {
            delete values.ipam;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.callParent();
    },
});

Ext.define('PVE.sdn.ipams.BaseEdit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        me.isCreate = !me.ipam;

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/sdn/ipams';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/cluster/sdn/ipams/' + me.ipam;
            me.method = 'PUT';
        }

        var ipanel = Ext.create(me.paneltype, {
            type: me.type,
            isCreate: me.isCreate,
            ipam: me.ipam,
        });

        Ext.apply(me, {
            subject: PVE.Utils.format_sdnipam_type(me.type),
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

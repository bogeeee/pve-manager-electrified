Ext.define('PVE.dc.PoolEdit', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveDcPoolEdit'],
    mixins: ['Proxmox.Mixin.CBind'],

    subject: gettext('Pool'),

    cbindData: {
        poolid: '',
        isCreate: (cfg) => !cfg.poolid,
    },

    cbind: {
        url: (get) => `/api2/extjs/pools/${!get('isCreate') ? '?poolid=' + get('poolid') : ''}`,
        method: (get) => (get('isCreate') ? 'POST' : 'PUT'),
    },

    items: [
        {
            xtype: 'pmxDisplayEditField',
            fieldLabel: gettext('Name'),
            cbind: {
                editable: '{isCreate}',
                value: '{poolid}',
            },
            name: 'poolid',
            allowBlank: false,
        },
        {
            xtype: 'textfield',
            fieldLabel: gettext('Comment'),
            name: 'comment',
            allowBlank: true,
        },
    ],

    initComponent: function () {
        let me = this;
        me.callParent();
        if (me.poolid) {
            me.load({
                success: function (response) {
                    let data = response.result.data;
                    if (Ext.isArray(data)) {
                        me.setValues(data[0]);
                    } else {
                        me.setValues(data);
                    }
                },
            });
        }
    },
});

Ext.define('PVE.qemu.RNGInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveRNGInputPanel',

    onlineHelp: 'qm_virtio_rng',

    onGetValues: function (values) {
        if (values.max_bytes === '') {
            values.max_bytes = '0';
        } else if (values.max_bytes === '1024' && values.period === '') {
            delete values.max_bytes;
        }

        var ret = PVE.Parser.printPropertyString(values);

        return {
            rng0: ret,
        };
    },

    setValues: function (values) {
        if (values.max_bytes === 0) {
            values.max_bytes = null;
        }

        this.callParent(arguments);
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            '#max_bytes': {
                change: function (el, newVal) {
                    let limitWarning = this.lookupReference('limitWarning');
                    limitWarning.setHidden(!!newVal);
                },
            },
        },
    },

    items: [
        {
            itemId: 'source',
            name: 'source',
            xtype: 'proxmoxKVComboBox',
            value: '/dev/urandom',
            fieldLabel: gettext('Entropy source'),
            labelWidth: 130,
            comboItems: [
                ['/dev/urandom', '/dev/urandom'],
                ['/dev/random', '/dev/random'],
                ['/dev/hwrng', '/dev/hwrng'],
            ],
        },
        {
            xtype: 'numberfield',
            itemId: 'max_bytes',
            name: 'max_bytes',
            minValue: 0,
            step: 1,
            value: 1024,
            fieldLabel: gettext('Limit (Bytes/Period)'),
            labelWidth: 130,
            emptyText: gettext('unlimited'),
        },
        {
            xtype: 'numberfield',
            name: 'period',
            minValue: 1,
            step: 1,
            fieldLabel: gettext('Period') + ' (ms)',
            labelWidth: 130,
            emptyText: '1000',
        },
        {
            xtype: 'displayfield',
            reference: 'limitWarning',
            value: gettext(
                'Disabling the limiter can potentially allow a guest to overload the host. Proceed with caution.',
            ),
            userCls: 'pmx-hint',
            hidden: true,
        },
    ],
});

Ext.define('PVE.qemu.RNGEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('VirtIO RNG'),

    items: [
        {
            xtype: 'pveRNGInputPanel',
        },
    ],

    initComponent: function () {
        var me = this;

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response) {
                    me.vmconfig = response.result.data;

                    var rng0 = me.vmconfig.rng0;
                    if (rng0) {
                        me.setValues(PVE.Parser.parsePropertyString(rng0));
                    }
                },
            });
        }
    },
});

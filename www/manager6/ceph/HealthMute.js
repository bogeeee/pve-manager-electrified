Ext.define('PVE.ceph.HealthMuteInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveCephHealthMuteInputPanel',

    items: [
        {
            xtype: 'displayfield',
            name: 'code',
            fieldLabel: gettext('Health Check'),
            submitValue: false,
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'ttl',
            fieldLabel: gettext('Duration'),
            editable: true,
            value: '__default__',
            // without this an empty field is submitted as a request to delete the property,
            // which this endpoint does not accept
            deleteEmpty: false,
            comboItems: [
                // KVComboBox cannot round-trip an empty string as a key, so use the
                // toolkit's '__default__' sentinel, which it already drops on submit
                ['__default__', gettext('No expiry')],
                ['1h', gettext('1 hour')],
                ['1d', gettext('1 day')],
                ['1w', gettext('1 week')],
                ['4w', gettext('4 weeks')],
            ],
            emptyText: gettext('No expiry'),
            autoEl: {
                tag: 'div',
                'data-qtip': gettext(
                    'Without a duration the mute stays until it is lifted by hand. A custom' +
                        ' duration combines amount and unit, for example 12h, 3d or 1d12h.',
                ),
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'sticky',
            fieldLabel: gettext('Keep Mute'),
            uncheckedValue: 0,
            value: 0,
            boxLabel: gettext('Stay muted even when more items become affected'),
        },
    ],

    onGetValues: function (values) {
        let ttl = (values.ttl ?? '').trim();
        if (ttl === '') {
            delete values.ttl;
        } else {
            values.ttl = ttl;
        }

        return { ...values, value: 1 };
    },
});

Ext.define('PVE.ceph.HealthMute', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCephHealthMute',

    title: gettext('Mute Health Check'),
    submitText: gettext('Mute'),
    isCreate: true,
    method: 'PUT',
    width: 480,

    items: [{ xtype: 'pveCephHealthMuteInputPanel' }],

    initComponent: function () {
        let me = this;

        if (!me.code) {
            throw 'no health check given';
        }
        me.url = `/cluster/ceph/health-mute/${me.code}`;

        me.callParent();

        me.setValues({ code: me.code });
    },
});

Ext.define('PVE.storage.IScsiScan', {
    extend: 'PVE.form.ComboBoxSetStoreNode',
    alias: 'widget.pveIScsiScan',

    queryParam: 'portal',
    valueField: 'target',
    displayField: 'target',
    matchFieldWidth: false,
    allowBlank: false,

    listConfig: {
        width: 350,
        columns: [
            {
                dataIndex: 'target',
                flex: 1,
            },
        ],
        emptyText: PVE.Utils.renderNotFound(gettext('iSCSI Target')),
    },

    config: {
        apiSuffix: '/scan/iscsi',
    },

    showNodeSelector: true,

    reload: function () {
        let me = this;
        if (!me.isDisabled()) {
            me.getStore().load();
        }
    },

    setPortal: function (portal) {
        let me = this;
        me.portal = portal;
        me.getStore().getProxy().setExtraParams({ portal });
        me.reload();
    },

    setNodeName: function (value) {
        let me = this;
        me.callParent([value]);
        me.reload();
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        let store = Ext.create('Ext.data.Store', {
            fields: ['target', 'portal'],
            proxy: {
                type: 'proxmox',
                url: `${me.apiBaseUrl}${me.nodename}${me.apiSuffix}`,
            },
        });
        store.sort('target', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.IScsiInputPanel', {
    extend: 'PVE.panel.StorageBase',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'storage_open_iscsi',

    onGetValues: function (values) {
        let me = this;

        values.content = values.luns ? 'images' : 'none';
        delete values.luns;

        return me.callParent([values]);
    },

    setValues: function (values) {
        values.luns = values.content.indexOf('images') !== -1;
        this.callParent([values]);
    },

    column1: [
        {
            xtype: 'pmxDisplayEditField',
            cbind: {
                editable: '{isCreate}',
            },

            name: 'portal',
            value: '',
            fieldLabel: 'Portal',
            allowBlank: false,

            editConfig: {
                listeners: {
                    change: {
                        fn: function (f, value) {
                            let panel = this.up('inputpanel');
                            let exportField = panel.lookup('iScsiTargetScan');
                            if (exportField) {
                                exportField.setDisabled(!value);
                                exportField.setPortal(value);
                                exportField.setValue('');
                            }
                        },
                        buffer: 500,
                    },
                },
            },
        },
        {
            cbind: {
                xtype: (get) => (get('isCreate') ? 'pveIScsiScan' : 'displayfield'),
                readOnly: '{!isCreate}',
                disabled: '{isCreate}',
            },

            name: 'target',
            value: '',
            fieldLabel: gettext('Target'),
            allowBlank: false,
            reference: 'iScsiTargetScan',
            listeners: {
                nodechanged: function (value) {
                    this.up('inputpanel').lookup('storageNodeRestriction').setValue(value);
                },
            },
        },
    ],

    column2: [
        {
            xtype: 'checkbox',
            name: 'luns',
            checked: true,
            fieldLabel: gettext('Use LUNs directly'),
        },
    ],
});

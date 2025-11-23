Ext.define('PVE.storage.VgSelector', {
    extend: 'PVE.form.ComboBoxSetStoreNode',
    alias: 'widget.pveVgSelector',
    valueField: 'vg',
    displayField: 'vg',
    queryMode: 'local',
    editable: false,

    listConfig: {
        columns: [
            {
                dataIndex: 'vg',
                flex: 1,
            },
        ],
        emptyText: PVE.Utils.renderNotFound('VGs'),
    },

    config: {
        apiSuffix: '/scan/lvm',
    },

    showNodeSelector: true,

    setNodeName: function (value) {
        let me = this;
        me.callParent([value]);
        me.getStore().load();
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        let store = Ext.create('Ext.data.Store', {
            autoLoad: {}, // true,
            fields: ['vg', 'size', 'free'],
            proxy: {
                type: 'proxmox',
                url: `${me.apiBaseUrl}${me.nodename}${me.apiSuffix}`,
            },
        });

        store.sort('vg', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.BaseStorageSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveBaseStorageSelector',

    existingGroupsText: gettext('Existing volume groups'),
    queryMode: 'local',
    editable: false,
    value: '',
    valueField: 'storage',
    displayField: 'text',
    initComponent: function () {
        let me = this;

        let store = Ext.create('Ext.data.Store', {
            autoLoad: {
                addRecords: true,
                params: {
                    type: 'iscsi',
                },
            },
            fields: [
                'storage',
                'type',
                'content',
                {
                    name: 'text',
                    convert: function (value, record) {
                        if (record.data.storage) {
                            return record.data.storage + ' (iSCSI)';
                        } else {
                            return me.existingGroupsText;
                        }
                    },
                },
            ],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/storage/',
            },
        });

        store.loadData([{ storage: '' }], true);

        store.sort('storage', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.LunSelector', {
    extend: 'PVE.form.FileSelector',
    alias: 'widget.pveStorageLunSelector',

    nodename: 'localhost',
    storageContent: 'images',
    allowBlank: false,

    initComponent: function () {
        let me = this;

        if (!PVE.Utils.isStandaloneNode()) {
            me.errorHeight = 140;
            Ext.apply(me.listConfig ?? {}, {
                tbar: {
                    xtype: 'toolbar',
                    items: [
                        {
                            xtype: 'pveStorageScanNodeSelector',
                            autoSelect: false,
                            fieldLabel: gettext('Node to scan'),
                            listeners: {
                                change: (_field, value) => me.setNodename(value),
                            },
                        },
                    ],
                },
                emptyText: me.listConfig?.emptyText ?? PVE.Utils.renderNotFound(gettext('Volume')),
            });
        }

        me.callParent();
    },
});

Ext.define('PVE.storage.LVMInputPanel', {
    extend: 'PVE.panel.StorageBase',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'storage_lvm',

    column1: [
        {
            xtype: 'pveBaseStorageSelector',
            name: 'basesel',
            fieldLabel: gettext('Base storage'),
            cbind: {
                disabled: '{!isCreate}',
                hidden: '{!isCreate}',
            },
            submitValue: false,
            listeners: {
                change: function (f, value) {
                    let me = this;
                    let vgField = me.up('inputpanel').lookup('volumeGroupSelector');
                    let vgNameField = me.up('inputpanel').lookup('vgName');
                    let baseField = me.up('inputpanel').lookup('lunSelector');

                    vgField.setVisible(!value);
                    vgField.setDisabled(!!value);

                    baseField.setVisible(!!value);
                    baseField.setDisabled(!value);
                    baseField.setStorage(value);

                    vgNameField.setVisible(!!value);
                    vgNameField.setDisabled(!value);
                },
            },
        },
        {
            xtype: 'pveStorageLunSelector',
            name: 'base',
            fieldLabel: gettext('Base volume'),
            reference: 'lunSelector',
            hidden: true,
            disabled: true,
        },
        {
            xtype: 'pveVgSelector',
            name: 'vgname',
            fieldLabel: gettext('Volume group'),
            reference: 'volumeGroupSelector',
            cbind: {
                disabled: '{!isCreate}',
                hidden: '{!isCreate}',
            },
            allowBlank: false,
            listeners: {
                nodechanged: function (value) {
                    this.up('inputpanel').lookup('storageNodeRestriction').setValue(value);
                },
            },
        },
        {
            name: 'vgname',
            fieldLabel: gettext('Volume group'),
            reference: 'vgName',
            cbind: {
                xtype: (get) => (get('isCreate') ? 'textfield' : 'displayfield'),
                hidden: '{isCreate}',
                disabled: '{isCreate}',
            },
            value: '',
            allowBlank: false,
        },
        {
            xtype: 'pveContentTypeSelector',
            cts: ['images', 'rootdir'],
            fieldLabel: gettext('Content'),
            name: 'content',
            value: ['images', 'rootdir'],
            multiSelect: true,
            allowBlank: false,
        },
    ],

    column2: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'shared',
            uncheckedValue: 0,
            fieldLabel: gettext('Shared'),
            autoEl: {
                tag: 'div',
                'data-qtip': gettext('Enable if the LVM is located on a shared LUN.'),
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'saferemove',
            uncheckedValue: 0,
            fieldLabel: gettext('Wipe Removed Volumes'),
        },
    ],
});

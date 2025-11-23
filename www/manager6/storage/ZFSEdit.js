Ext.define('PVE.storage.ZFSInputPanel', {
    extend: 'PVE.panel.StorageBase',

    viewModel: {
        parent: null,
        data: {
            isLIO: false,
            isComstar: true,
            hasWriteCacheOption: true,
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            'field[name=iscsiprovider]': {
                change: 'changeISCSIProvider',
            },
        },
        changeISCSIProvider: function (f, newVal, oldVal) {
            var vm = this.getViewModel();
            vm.set('isLIO', newVal === 'LIO');
            vm.set('isComstar', newVal === 'comstar');
            vm.set('hasWriteCacheOption', newVal === 'comstar' || newVal === 'istgt');
        },
    },

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.content = 'images';
        }

        values.nowritecache = values.writecache ? 0 : 1;
        delete values.writecache;

        return me.callParent([values]);
    },

    setValues: function (values) {
        values.writecache = values.nowritecache ? 0 : 1;
        this.callParent([values]);
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'portal',
                value: '',
                fieldLabel: gettext('Portal'),
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'pool',
                value: '',
                fieldLabel: gettext('Pool'),
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'blocksize',
                value: '4k',
                fieldLabel: gettext('Block Size'),
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'target',
                value: '',
                fieldLabel: gettext('Target'),
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'comstar_tg',
                value: '',
                fieldLabel: gettext('Target group'),
                bind: me.isCreate ? { disabled: '{!isComstar}' } : { hidden: '{!isComstar}' },
                allowBlank: true,
            },
        ];

        me.column2 = [
            {
                xtype: me.isCreate ? 'pveiScsiProviderSelector' : 'displayfield',
                name: 'iscsiprovider',
                value: 'comstar',
                fieldLabel: gettext('iSCSI Provider'),
                allowBlank: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'sparse',
                checked: false,
                uncheckedValue: 0,
                fieldLabel: gettext('Thin provision'),
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'writecache',
                checked: true,
                bind: me.isCreate
                    ? { disabled: '{!hasWriteCacheOption}' }
                    : { hidden: '{!hasWriteCacheOption}' },
                uncheckedValue: 0,
                fieldLabel: gettext('Write cache'),
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'comstar_hg',
                value: '',
                bind: me.isCreate ? { disabled: '{!isComstar}' } : { hidden: '{!isComstar}' },
                fieldLabel: gettext('Host group'),
                allowBlank: true,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'lio_tpg',
                value: '',
                bind: me.isCreate ? { disabled: '{!isLIO}' } : { hidden: '{!isLIO}' },
                allowBlank: false,
                fieldLabel: gettext('Target portal group'),
            },
        ];

        me.callParent();
    },
});

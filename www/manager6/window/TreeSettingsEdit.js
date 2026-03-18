Ext.define('PVE.window.TreeSettingsEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveTreeSettingsEdit',

    title: gettext('Tree Settings'),
    isCreate: false,

    url: '#', // ignored as submit() gets overridden here, but the parent class requires it

    width: 450,
    fieldDefaults: {
        labelWidth: 150,
    },

    items: [
        {
            xtype: 'inputpanel',
            items: [
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'sort-field',
                    fieldLabel: gettext('Sort Key'),
                    comboItems: [
                        ['__default__', `${Proxmox.Utils.defaultText} (VMID)`],
                        ['vmid', 'VMID'],
                        ['name', gettext('Name')],
                    ],
                    defaultValue: '__default__',
                    value: '__default__',
                    deleteEmpty: false,
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'group-templates',
                    fieldLabel: gettext('Group Templates'),
                    comboItems: [
                        ['__default__', `${Proxmox.Utils.defaultText} (${gettext('Yes')})`],
                        [1, gettext('Yes')],
                        [0, gettext('No')],
                    ],
                    defaultValue: '__default__',
                    value: '__default__',
                    deleteEmpty: false,
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'group-guest-types',
                    fieldLabel: gettext('Group Guest Types'),
                    comboItems: [
                        ['__default__', `${Proxmox.Utils.defaultText} (${gettext('Yes')})`],
                        [1, gettext('Yes')],
                        [0, gettext('No')],
                    ],
                    defaultValue: '__default__',
                    value: '__default__',
                    deleteEmpty: false,
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'nest-pools',
                    fieldLabel: gettext('Nest Pools'),
                    comboItems: [
                        ['__default__', `${Proxmox.Utils.defaultText} (${gettext('Yes')})`],
                        [1, gettext('Yes')],
                        [0, gettext('No')],
                    ],
                    defaultValue: '__default__',
                    value: '__default__',
                    deleteEmpty: false,
                },
                {
                    xtype: 'displayfield',
                    userCls: 'pmx-hint',
                    value: gettext('Settings are saved in the local storage of the browser'),
                },
            ],
        },
    ],

    submit: function () {
        let me = this;

        let localStorage = Ext.state.Manager.getProvider();
        localStorage.set('pve-tree-sorting', me.down('inputpanel').getValues() || null);

        me.apiCallDone();
        me.close();
    },

    initComponent: function () {
        let me = this;

        me.callParent();

        let localStorage = Ext.state.Manager.getProvider();
        me.down('inputpanel').setValues(localStorage.get('pve-tree-sorting'));
    },
});

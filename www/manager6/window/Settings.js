Ext.define('PVE.window.Settings', {
    extend: 'Ext.window.Window',

    width: '800px',
    title: gettext('My Settings'),
    iconCls: 'fa fa-gear',
    modal: true,
    bodyPadding: 10,
    resizable: false,

    buttons: [
        {
            xtype: 'proxmoxHelpButton',
            onlineHelp: 'gui_my_settings',
            hidden: false,
        },
        '->',
        {
            text: gettext('Close'),
            handler: function () {
                this.up('window').close();
            },
        },
    ],

    layout: 'hbox',

    controller: {
        xclass: 'Ext.app.ViewController',

        init: function (view) {
            var me = this;
            var sp = Ext.state.Manager.getProvider();

            var username = sp.get('login-username') || Proxmox.Utils.noneText;
            me.lookupReference('savedUserName').setValue(Ext.String.htmlEncode(username));
            var vncMode = sp.get('novnc-scaling') || 'auto';
            me.lookupReference('noVNCScalingGroup').setValue({ noVNCScalingField: vncMode });

            let summarycolumns = sp.get('summarycolumns', 'auto');
            me.lookup('summarycolumns').setValue(summarycolumns);

            me.lookup('guestNotesCollapse').setValue(sp.get('guest-notes-collapse', 'never'));
            me.lookup('editNotesOnDoubleClick').setValue(
                sp.get('edit-notes-on-double-click', false),
            );

            var settings = ['fontSize', 'fontFamily', 'letterSpacing', 'lineHeight'];
            settings.forEach(function (setting) {
                var val = localStorage.getItem('pve-xterm-' + setting);
                if (val !== undefined && val !== null) {
                    let field = me.lookup(setting);
                    field.setValue(val);
                    field.resetOriginalValue();
                }
            });
        },

        set_button_status: function () {
            let me = this;
            let form = me.lookup('xtermform');

            let valid = form.isValid(),
                dirty = form.isDirty();
            let hasValues = Object.values(form.getValues()).some((v) => !!v);

            me.lookup('xtermsave').setDisabled(!dirty || !valid);
            me.lookup('xtermreset').setDisabled(!hasValues);
        },

        control: {
            '#xtermjs form': {
                dirtychange: 'set_button_status',
                validitychange: 'set_button_status',
            },
            '#xtermjs button': {
                click: function (button) {
                    var me = this;
                    var settings = ['fontSize', 'fontFamily', 'letterSpacing', 'lineHeight'];
                    settings.forEach(function (setting) {
                        var field = me.lookup(setting);
                        if (button.reference === 'xtermsave') {
                            let value = field.getValue();
                            if (value) {
                                localStorage.setItem('pve-xterm-' + setting, value);
                            } else {
                                localStorage.removeItem('pve-xterm-' + setting);
                            }
                        } else if (button.reference === 'xtermreset') {
                            field.setValue(undefined);
                            localStorage.removeItem('pve-xterm-' + setting);
                        }
                        field.resetOriginalValue();
                    });
                    me.set_button_status();
                },
            },
            'button[name=reset]': {
                click: function () {
                    let blacklist = ['GuiCap', 'login-username', 'dash-storages'];
                    let sp = Ext.state.Manager.getProvider();
                    for (const state of Object.keys(sp.state)) {
                        if (!blacklist.includes(state)) {
                            sp.clear(state);
                        }
                    }
                    window.location.reload();
                },
            },
            'button[name=clear-username]': {
                click: function () {
                    let me = this;
                    me.lookupReference('savedUserName').setValue(Proxmox.Utils.noneText);
                    Ext.state.Manager.getProvider().clear('login-username');
                },
            },
            'grid[reference=dashboard-storages]': {
                selectionchange: function (grid, selected) {
                    var _me = this;
                    var sp = Ext.state.Manager.getProvider();

                    // saves the selected storageids as "id1,id2,id3,..." or clears the variable
                    if (selected.length > 0) {
                        sp.set('dash-storages', Ext.Array.pluck(selected, 'id').join(','));
                    } else {
                        sp.clear('dash-storages');
                    }
                },
                afterrender: function (grid) {
                    let store = grid.getStore();
                    let storages = Ext.state.Manager.getProvider().get('dash-storages') || '';

                    let items = [];
                    storages.split(',').forEach((storage) => {
                        if (storage !== '') {
                            // we have to get the records to be able to select them
                            let item = store.getById(storage);
                            if (item) {
                                items.push(item);
                            }
                        }
                    });
                    grid.suspendEvent('selectionchange');
                    grid.getSelectionModel().select(items);
                    grid.resumeEvent('selectionchange');
                },
            },
            'field[reference=summarycolumns]': {
                change: (el, newValue) =>
                    Ext.state.Manager.getProvider().set('summarycolumns', newValue),
            },
            'field[reference=guestNotesCollapse]': {
                change: (e, v) => Ext.state.Manager.getProvider().set('guest-notes-collapse', v),
            },
            'field[reference=editNotesOnDoubleClick]': {
                change: (e, v) =>
                    Ext.state.Manager.getProvider().set('edit-notes-on-double-click', v),
            },
        },
    },

    items: [
        {
            xtype: 'fieldset',
            flex: 1,
            title: gettext('Webinterface Settings'),
            margin: '5',
            layout: {
                type: 'vbox',
                align: 'left',
            },
            defaults: {
                width: '100%',
                margin: '0 0 10 0',
            },
            items: [
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Dashboard Storages'),
                    labelAlign: 'left',
                    labelWidth: '50%',
                },
                {
                    xtype: 'grid',
                    maxHeight: 150,
                    reference: 'dashboard-storages',
                    selModel: {
                        selType: 'checkboxmodel',
                    },
                    columns: [
                        {
                            header: gettext('Name'),
                            dataIndex: 'storage',
                            flex: 1,
                        },
                        {
                            header: gettext('Node'),
                            dataIndex: 'node',
                            flex: 1,
                        },
                    ],
                    store: {
                        type: 'diff',
                        field: ['type', 'storage', 'id', 'node'],
                        rstore: PVE.data.ResourceStore,
                        filters: [
                            {
                                property: 'type',
                                value: 'storage',
                            },
                        ],
                        sorters: ['node', 'storage'],
                    },
                },
                {
                    xtype: 'box',
                    autoEl: { tag: 'hr' },
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'displayfield',
                            fieldLabel: gettext('Saved User Name') + ':',
                            labelWidth: 150,
                            stateId: 'login-username',
                            reference: 'savedUserName',
                            flex: 1,
                            value: '',
                        },
                        {
                            xtype: 'button',
                            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                            text: gettext('Reset'),
                            name: 'clear-username',
                        },
                    ],
                },
                {
                    xtype: 'box',
                    autoEl: { tag: 'hr' },
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'displayfield',
                            fieldLabel: gettext('Layout') + ':',
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
                            text: gettext('Reset'),
                            tooltip: gettext(
                                'Reset all layout changes (for example, column widths)',
                            ),
                            name: 'reset',
                        },
                    ],
                },
                {
                    xtype: 'box',
                    autoEl: { tag: 'hr' },
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    fieldLabel: gettext('Summary columns') + ':',
                    labelWidth: 125,
                    stateId: 'summarycolumns',
                    reference: 'summarycolumns',
                    comboItems: [
                        ['auto', 'auto'],
                        ['1', '1'],
                        ['2', '2'],
                        ['3', '3'],
                    ],
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    fieldLabel: gettext('Guest Notes') + ':',
                    labelWidth: 125,
                    stateId: 'guest-notes-collapse',
                    reference: 'guestNotesCollapse',
                    comboItems: [
                        ['never', 'Show by default'],
                        ['always', 'Collapse by default'],
                        ['auto', 'auto (Collapse if empty)'],
                    ],
                },
                {
                    xtype: 'checkbox',
                    fieldLabel: gettext('Notes'),
                    labelWidth: 125,
                    boxLabel: gettext('Open editor on double-click'),
                    reference: 'editNotesOnDoubleClick',
                    inputValue: true,
                    uncheckedValue: false,
                },
            ],
        },
        {
            xtype: 'container',
            layout: 'vbox',
            flex: 1,
            margin: '5',
            defaults: {
                width: '100%',
                // right margin ensures that the right border of the fieldsets
                // is shown
                margin: '0 2 10 0',
            },
            items: [
                {
                    xtype: 'fieldset',
                    itemId: 'xtermjs',
                    title: gettext('xterm.js Settings'),
                    items: [
                        {
                            xtype: 'form',
                            reference: 'xtermform',
                            border: false,
                            layout: {
                                type: 'vbox',
                                algin: 'left',
                            },
                            defaults: {
                                width: '100%',
                                margin: '0 0 10 0',
                            },
                            items: [
                                {
                                    xtype: 'textfield',
                                    name: 'fontFamily',
                                    reference: 'fontFamily',
                                    emptyText: Proxmox.Utils.defaultText,
                                    fieldLabel: gettext('Font-Family'),
                                },
                                {
                                    xtype: 'proxmoxintegerfield',
                                    emptyText: Proxmox.Utils.defaultText,
                                    name: 'fontSize',
                                    reference: 'fontSize',
                                    minValue: 1,
                                    fieldLabel: gettext('Font-Size'),
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'letterSpacing',
                                    reference: 'letterSpacing',
                                    emptyText: Proxmox.Utils.defaultText,
                                    fieldLabel: gettext('Letter Spacing'),
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'lineHeight',
                                    minValue: 0.1,
                                    reference: 'lineHeight',
                                    emptyText: Proxmox.Utils.defaultText,
                                    fieldLabel: gettext('Line Height'),
                                },
                                {
                                    xtype: 'container',
                                    layout: {
                                        type: 'hbox',
                                        pack: 'end',
                                    },
                                    defaults: {
                                        margin: '0 0 0 5',
                                    },
                                    items: [
                                        {
                                            xtype: 'button',
                                            reference: 'xtermreset',
                                            disabled: true,
                                            text: gettext('Reset'),
                                        },
                                        {
                                            xtype: 'button',
                                            reference: 'xtermsave',
                                            disabled: true,
                                            text: gettext('Save'),
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    xtype: 'fieldset',
                    title: gettext('noVNC Settings'),
                    items: [
                        {
                            xtype: 'radiogroup',
                            fieldLabel: gettext('Scaling mode'),
                            reference: 'noVNCScalingGroup',
                            height: '15px', // renders faster with value assigned
                            layout: {
                                type: 'hbox',
                            },
                            items: [
                                {
                                    xtype: 'radiofield',
                                    name: 'noVNCScalingField',
                                    inputValue: 'auto',
                                    boxLabel: 'Auto',
                                },
                                {
                                    xtype: 'radiofield',
                                    name: 'noVNCScalingField',
                                    inputValue: 'scale',
                                    boxLabel: 'Local Scaling',
                                    margin: '0 0 0 10',
                                },
                                {
                                    xtype: 'radiofield',
                                    name: 'noVNCScalingField',
                                    inputValue: 'off',
                                    boxLabel: 'Off',
                                    margin: '0 0 0 10',
                                },
                            ],
                            listeners: {
                                change: function (el, { noVNCScalingField }) {
                                    let provider = Ext.state.Manager.getProvider();
                                    if (noVNCScalingField === 'auto') {
                                        provider.clear('novnc-scaling');
                                    } else {
                                        provider.set('novnc-scaling', noVNCScalingField);
                                    }
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
});

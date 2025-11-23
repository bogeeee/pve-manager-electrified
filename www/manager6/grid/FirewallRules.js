Ext.define('PVE.form.FWMacroSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveFWMacroSelector',

    allowBlank: true,
    autoSelect: false,
    valueField: 'macro',
    displayField: 'macro',

    listConfig: {
        columns: [
            {
                header: gettext('Macro'),
                dataIndex: 'macro',
                hideable: false,
                width: 100,
            },
            {
                header: gettext('Description'),
                renderer: Ext.String.htmlEncode,
                flex: 1,
                dataIndex: 'descr',
            },
        ],
    },
    initComponent: function () {
        var me = this;

        var store = Ext.create('Ext.data.Store', {
            autoLoad: true,
            fields: ['macro', 'descr'],
            idProperty: 'macro',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/firewall/macros',
            },
            sorters: {
                property: 'macro',
                direction: 'ASC',
            },
        });

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.form.ICMPTypeSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveICMPTypeSelector',

    allowBlank: true,
    autoSelect: false,
    valueField: 'name',
    displayField: 'name',

    listConfig: {
        columns: [
            {
                header: gettext('Type'),
                dataIndex: 'type',
                hideable: false,
                sortable: false,
                width: 50,
            },
            {
                header: gettext('Name'),
                dataIndex: 'name',
                hideable: false,
                sortable: false,
                flex: 1,
            },
        ],
    },
    setName: function (value) {
        this.name = value;
    },
});

let ICMP_TYPE_NAMES_STORE = Ext.create('Ext.data.Store', {
    field: ['type', 'name'],
    data: [
        { type: 'any', name: 'any' },
        { type: '0', name: 'echo-reply' },
        { type: '3', name: 'destination-unreachable' },
        { type: '3/0', name: 'network-unreachable' },
        { type: '3/1', name: 'host-unreachable' },
        { type: '3/2', name: 'protocol-unreachable' },
        { type: '3/3', name: 'port-unreachable' },
        { type: '3/4', name: 'fragmentation-needed' },
        { type: '3/5', name: 'source-route-failed' },
        { type: '3/6', name: 'network-unknown' },
        { type: '3/7', name: 'host-unknown' },
        { type: '3/9', name: 'network-prohibited' },
        { type: '3/10', name: 'host-prohibited' },
        { type: '3/11', name: 'TOS-network-unreachable' },
        { type: '3/12', name: 'TOS-host-unreachable' },
        { type: '3/13', name: 'communication-prohibited' },
        { type: '3/14', name: 'host-precedence-violation' },
        { type: '3/15', name: 'precedence-cutoff' },
        { type: '4', name: 'source-quench' },
        { type: '5', name: 'redirect' },
        { type: '5/0', name: 'network-redirect' },
        { type: '5/1', name: 'host-redirect' },
        { type: '5/2', name: 'TOS-network-redirect' },
        { type: '5/3', name: 'TOS-host-redirect' },
        { type: '8', name: 'echo-request' },
        { type: '9', name: 'router-advertisement' },
        { type: '10', name: 'router-solicitation' },
        { type: '11', name: 'time-exceeded' },
        { type: '11/0', name: 'ttl-zero-during-transit' },
        { type: '11/1', name: 'ttl-zero-during-reassembly' },
        { type: '12', name: 'parameter-problem' },
        { type: '12/0', name: 'ip-header-bad' },
        { type: '12/1', name: 'required-option-missing' },
        { type: '13', name: 'timestamp-request' },
        { type: '14', name: 'timestamp-reply' },
        { type: '17', name: 'address-mask-request' },
        { type: '18', name: 'address-mask-reply' },
    ],
});
let ICMPV6_TYPE_NAMES_STORE = Ext.create('Ext.data.Store', {
    field: ['type', 'name'],
    data: [
        { type: '1', name: 'destination-unreachable' },
        { type: '1/0', name: 'no-route' },
        { type: '1/1', name: 'communication-prohibited' },
        { type: '1/2', name: 'beyond-scope' },
        { type: '1/3', name: 'address-unreachable' },
        { type: '1/4', name: 'port-unreachable' },
        { type: '1/5', name: 'failed-policy' },
        { type: '1/6', name: 'reject-route' },
        { type: '2', name: 'packet-too-big' },
        { type: '3', name: 'time-exceeded' },
        { type: '3/0', name: 'ttl-zero-during-transit' },
        { type: '3/1', name: 'ttl-zero-during-reassembly' },
        { type: '4', name: 'parameter-problem' },
        { type: '4/0', name: 'bad-header' },
        { type: '4/1', name: 'unknown-header-type' },
        { type: '4/2', name: 'unknown-option' },
        { type: '128', name: 'echo-request' },
        { type: '129', name: 'echo-reply' },
        { type: '133', name: 'router-solicitation' },
        { type: '134', name: 'router-advertisement' },
        { type: '135', name: 'neighbour-solicitation' },
        { type: '136', name: 'neighbour-advertisement' },
        { type: '137', name: 'redirect' },
    ],
});

let DEFAULT_ALLOWED_DIRECTIONS = ['in', 'out'];

let ALLOWED_DIRECTIONS = {
    dc: ['in', 'out', 'forward'],
    node: ['in', 'out', 'forward'],
    group: ['in', 'out', 'forward'],
    vm: ['in', 'out'],
    vnet: ['forward'],
};

let DEFAULT_ALLOWED_ACTIONS = ['ACCEPT', 'REJECT', 'DROP'];

let ALLOWED_ACTIONS = {
    in: ['ACCEPT', 'REJECT', 'DROP'],
    out: ['ACCEPT', 'REJECT', 'DROP'],
    forward: ['ACCEPT', 'DROP'],
};

Ext.define('PVE.FirewallRulePanel', {
    extend: 'Proxmox.panel.InputPanel',

    allow_iface: false,

    list_refs_url: undefined,

    firewall_type: undefined,
    action_selector: undefined,
    forward_warning: undefined,

    onGetValues: function (values) {
        var _me = this;

        // hack: editable ComboGrid returns nothing when empty, so we need to set ''
        // Also, disabled text fields return nothing, so we need to set ''

        Ext.Array.each(
            ['source', 'dest', 'macro', 'proto', 'sport', 'dport', 'icmp-type', 'log'],
            function (key) {
                if (values[key] === undefined) {
                    values[key] = '';
                }
            },
        );

        delete values.modified_marker;

        return values;
    },

    setValidActions: function (type) {
        let me = this;

        let allowed_actions = ALLOWED_ACTIONS[type] ?? DEFAULT_ALLOWED_ACTIONS;
        me.action_selector.setComboItems(allowed_actions.map((action) => [action, action]));
    },

    setForwardWarning: function (type) {
        let me = this;
        me.forward_warning.setHidden(type !== 'forward');
    },

    onSetValues: function (values) {
        let me = this;

        if (values.type) {
            me.setValidActions(values.type);
            me.setForwardWarning(values.type);
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        if (!me.list_refs_url) {
            throw 'no list_refs_url specified';
        }

        let allowed_directions = ALLOWED_DIRECTIONS[me.firewall_type] ?? DEFAULT_ALLOWED_DIRECTIONS;

        me.action_selector = Ext.create('Proxmox.form.KVComboBox', {
            xtype: 'proxmoxKVComboBox',
            name: 'action',
            value: 'ACCEPT',
            comboItems: DEFAULT_ALLOWED_ACTIONS.map((action) => [action, action]),
            fieldLabel: gettext('Action'),
            allowBlank: false,
        });

        me.forward_warning = Ext.create('Proxmox.form.field.DisplayEdit', {
            userCls: 'pmx-hint',
            value: gettext(
                'Forward rules only take effect when the nftables firewall is activated in the host options',
            ),
            hidden: true,
        });

        me.column1 = [
            {
                // hack: we use this field to mark the form 'dirty' when the
                // record has errors- so that the user can safe the unmodified
                // form again.
                xtype: 'hiddenfield',
                name: 'modified_marker',
                value: '',
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'type',
                value: allowed_directions[0],
                comboItems: allowed_directions.map((dir) => [dir, dir]),
                fieldLabel: gettext('Direction'),
                allowBlank: false,
                listeners: {
                    change: function (f, value) {
                        me.setValidActions(value);
                        me.setForwardWarning(value);
                    },
                },
            },
            me.action_selector,
        ];

        if (me.allow_iface) {
            me.column1.push({
                xtype: 'proxmoxtextfield',
                name: 'iface',
                deleteEmpty: !me.isCreate,
                value: '',
                fieldLabel: gettext('Interface'),
            });
        } else {
            me.column1.push({
                xtype: 'displayfield',
                fieldLabel: '',
                value: '',
            });
        }

        me.column1.push(
            {
                xtype: 'displayfield',
                fieldLabel: '',
                height: 7,
                value: '',
            },
            {
                xtype: 'pveIPRefSelector',
                name: 'source',
                autoSelect: false,
                editable: true,
                base_url: me.list_refs_url,
                fieldLabel: gettext('Source'),
                maxLength: 512,
                maxLengthText: gettext('Too long, consider using IP sets.'),
            },
            {
                xtype: 'pveIPRefSelector',
                name: 'dest',
                autoSelect: false,
                editable: true,
                base_url: me.list_refs_url,
                fieldLabel: gettext('Destination'),
                maxLength: 512,
                maxLengthText: gettext('Too long, consider using IP sets.'),
            },
        );

        me.column2 = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'enable',
                checked: false,
                uncheckedValue: 0,
                fieldLabel: gettext('Enable'),
            },
            {
                xtype: 'pveFWMacroSelector',
                name: 'macro',
                fieldLabel: gettext('Macro'),
                editable: true,
                allowBlank: true,
                listeners: {
                    change: function (f, value) {
                        if (value === null) {
                            me.down('field[name=proto]').setDisabled(false);
                            me.down('field[name=sport]').setDisabled(false);
                            me.down('field[name=dport]').setDisabled(false);
                        } else {
                            me.down('field[name=proto]').setDisabled(true);
                            me.down('field[name=proto]').setValue('');
                            me.down('field[name=sport]').setDisabled(true);
                            me.down('field[name=sport]').setValue('');
                            me.down('field[name=dport]').setDisabled(true);
                            me.down('field[name=dport]').setValue('');
                        }
                    },
                },
            },
            {
                xtype: 'pveIPProtocolSelector',
                name: 'proto',
                autoSelect: false,
                editable: true,
                value: '',
                fieldLabel: gettext('Protocol'),
                listeners: {
                    change: function (f, value) {
                        if (value === 'icmp' || value === 'icmpv6' || value === 'ipv6-icmp') {
                            me.down('field[name=dport]').setHidden(true);
                            me.down('field[name=dport]').setDisabled(true);
                            if (value === 'icmp') {
                                me.down('#icmpv4-type').setHidden(false);
                                me.down('#icmpv4-type').setDisabled(false);
                                me.down('#icmpv6-type').setHidden(true);
                                me.down('#icmpv6-type').setDisabled(true);
                            } else {
                                me.down('#icmpv6-type').setHidden(false);
                                me.down('#icmpv6-type').setDisabled(false);
                                me.down('#icmpv4-type').setHidden(true);
                                me.down('#icmpv4-type').setDisabled(true);
                            }
                        } else {
                            me.down('#icmpv4-type').setHidden(true);
                            me.down('#icmpv4-type').setDisabled(true);
                            me.down('#icmpv6-type').setHidden(true);
                            me.down('#icmpv6-type').setDisabled(true);
                            me.down('field[name=dport]').setHidden(false);
                            me.down('field[name=dport]').setDisabled(false);
                        }
                    },
                },
            },
            {
                xtype: 'displayfield',
                fieldLabel: '',
                height: 7,
                value: '',
            },
            {
                xtype: 'textfield',
                name: 'sport',
                value: '',
                fieldLabel: gettext('Source port'),
            },
            {
                xtype: 'textfield',
                name: 'dport',
                value: '',
                fieldLabel: gettext('Dest. port'),
            },
            {
                xtype: 'pveICMPTypeSelector',
                name: 'icmp-type',
                id: 'icmpv4-type',
                autoSelect: false,
                editable: true,
                hidden: true,
                disabled: true,
                value: '',
                fieldLabel: gettext('ICMP type'),
                store: ICMP_TYPE_NAMES_STORE,
            },
            {
                xtype: 'pveICMPTypeSelector',
                name: 'icmp-type',
                id: 'icmpv6-type',
                autoSelect: false,
                editable: true,
                hidden: true,
                disabled: true,
                value: '',
                fieldLabel: gettext('ICMP type'),
                store: ICMPV6_TYPE_NAMES_STORE,
            },
        ];

        me.advancedColumn1 = [
            {
                xtype: 'pveFirewallLogLevels',
            },
        ];

        me.columnB = [
            {
                xtype: 'textfield',
                name: 'comment',
                value: '',
                fieldLabel: gettext('Comment'),
            },
            me.forward_warning,
        ];

        me.callParent();

        if (me.isCreate) {
            // on create we never change the values, so we need to trigger this
            // manually
            me.setValidActions(me.getValues().type);
            me.setForwardWarning(me.getValues().type);
        }
    },
});

Ext.define('PVE.FirewallRuleEdit', {
    extend: 'Proxmox.window.Edit',

    base_url: undefined,
    list_refs_url: undefined,

    allow_iface: false,

    firewall_type: undefined,

    initComponent: function () {
        var me = this;

        if (!me.base_url) {
            throw 'no base_url specified';
        }
        if (!me.list_refs_url) {
            throw 'no list_refs_url specified';
        }

        me.isCreate = me.rule_pos === undefined;

        if (me.isCreate) {
            me.url = '/api2/extjs' + me.base_url;
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs' + me.base_url + '/' + me.rule_pos.toString();
            me.method = 'PUT';
        }

        var ipanel = Ext.create('PVE.FirewallRulePanel', {
            isCreate: me.isCreate,
            list_refs_url: me.list_refs_url,
            allow_iface: me.allow_iface,
            rule_pos: me.rule_pos,
            firewall_type: me.firewall_type,
        });

        Ext.apply(me, {
            subject: gettext('Rule'),
            isAdd: true,
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;
                    ipanel.setValues(values);
                    // set icmp-type again after protocol has been set
                    if (values['icmp-type'] !== undefined) {
                        ipanel.setValues({ 'icmp-type': values['icmp-type'] });
                    }
                    if (values.errors) {
                        let field = me.query('[isFormField][name=modified_marker]')[0];
                        field.setValue(1);
                        Ext.Function.defer(function () {
                            var form = ipanel.up('form').getForm();
                            form.markInvalid(values.errors);
                        }, 100);
                    }
                },
            });
        } else if (me.rec) {
            ipanel.setValues(me.rec.data);
        }
    },
});

Ext.define('PVE.FirewallGroupRuleEdit', {
    extend: 'Proxmox.window.Edit',

    base_url: undefined,

    allow_iface: false,

    initComponent: function () {
        var me = this;

        me.isCreate = me.rule_pos === undefined;

        if (me.isCreate) {
            me.url = '/api2/extjs' + me.base_url;
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs' + me.base_url + '/' + me.rule_pos.toString();
            me.method = 'PUT';
        }

        var column1 = [
            {
                xtype: 'hiddenfield',
                name: 'type',
                value: 'group',
            },
            {
                xtype: 'pveSecurityGroupsSelector',
                name: 'action',
                value: '',
                fieldLabel: gettext('Security Group'),
                allowBlank: false,
            },
        ];

        if (me.allow_iface) {
            column1.push({
                xtype: 'proxmoxtextfield',
                name: 'iface',
                deleteEmpty: !me.isCreate,
                value: '',
                fieldLabel: gettext('Interface'),
            });
        }

        var ipanel = Ext.create('Proxmox.panel.InputPanel', {
            isCreate: me.isCreate,
            column1: column1,
            column2: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'enable',
                    checked: false,
                    uncheckedValue: 0,
                    fieldLabel: gettext('Enable'),
                },
            ],
            columnB: [
                {
                    xtype: 'textfield',
                    name: 'comment',
                    value: '',
                    fieldLabel: gettext('Comment'),
                },
            ],
        });

        Ext.apply(me, {
            subject: gettext('Rule'),
            isAdd: true,
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;
                    ipanel.setValues(values);
                },
            });
        }
    },
});

Ext.define(
    'PVE.FirewallRules',
    {
        extend: 'Ext.grid.Panel',
        alias: 'widget.pveFirewallRules',

        onlineHelp: 'chapter_pve_firewall',
        emptyText: gettext('No firewall rule configured here.'),

        stateful: true,
        stateId: 'grid-firewall-rules',

        base_url: undefined,
        list_refs_url: undefined,

        addBtn: undefined,
        removeBtn: undefined,
        editBtn: undefined,
        groupBtn: undefined,

        tbar_prefix: undefined,

        allow_groups: true,
        allow_iface: false,

        firewall_type: undefined,

        setBaseUrl: function (url) {
            var me = this;

            me.base_url = url;

            if (url === undefined) {
                me.addBtn.setDisabled(true);
                if (me.groupBtn) {
                    me.groupBtn.setDisabled(true);
                }
                me.store.removeAll();
            } else {
                if (me.canEdit) {
                    me.addBtn.setDisabled(false);
                    if (me.groupBtn) {
                        me.groupBtn.setDisabled(false);
                    }
                }
                me.removeBtn.baseurl = url + '/';

                me.store.setProxy({
                    type: 'proxmox',
                    url: '/api2/json' + url,
                });

                me.store.load();
            }
        },

        moveRule: function (from, to) {
            var me = this;

            if (!me.base_url) {
                return;
            }

            Proxmox.Utils.API2Request({
                url: me.base_url + '/' + from,
                method: 'PUT',
                params: { moveto: to },
                waitMsgTarget: me,
                failure: function (response, options) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
                callback: function () {
                    me.store.load();
                },
            });
        },

        updateRule: function (rule) {
            var me = this;

            if (!me.base_url) {
                return;
            }

            rule.enable = rule.enable ? 1 : 0;

            var pos = rule.pos;
            delete rule.pos;
            delete rule.errors;

            Proxmox.Utils.API2Request({
                url: me.base_url + '/' + pos.toString(),
                method: 'PUT',
                params: rule,
                waitMsgTarget: me,
                failure: function (response, options) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
                callback: function () {
                    me.store.load();
                },
            });
        },

        initComponent: function () {
            var me = this;

            if (!me.list_refs_url) {
                throw 'no list_refs_url specified';
            }

            var store = Ext.create('Ext.data.Store', {
                model: 'pve-fw-rule',
            });

            var reload = function () {
                store.load();
            };

            var sm = Ext.create('Ext.selection.RowModel', {});

            me.caps = Ext.state.Manager.get('GuiCap');
            me.canEdit =
                !!me.caps.vms['VM.Config.Network'] ||
                !!me.caps.dc['Sys.Modify'] ||
                !!me.caps.nodes['Sys.Modify'];

            var run_editor = function () {
                var rec = sm.getSelection()[0];
                if (!rec || !me.canEdit) {
                    return;
                }
                var type = rec.data.type;

                var editor;
                if (type === 'in' || type === 'out' || type === 'forward') {
                    editor = 'PVE.FirewallRuleEdit';
                } else if (type === 'group') {
                    editor = 'PVE.FirewallGroupRuleEdit';
                } else {
                    return;
                }

                var win = Ext.create(editor, {
                    firewall_type: me.firewall_type,
                    digest: rec.data.digest,
                    allow_iface: me.allow_iface,
                    base_url: me.base_url,
                    list_refs_url: me.list_refs_url,
                    rule_pos: rec.data.pos,
                });

                win.show();
                win.on('destroy', reload);
            };

            me.editBtn = Ext.create('Proxmox.button.Button', {
                text: gettext('Edit'),
                disabled: true,
                enableFn: (rec) => me.canEdit,
                selModel: sm,
                handler: run_editor,
            });

            me.addBtn = Ext.create('Ext.Button', {
                text: gettext('Add'),
                disabled: true,
                handler: function () {
                    var win = Ext.create('PVE.FirewallRuleEdit', {
                        firewall_type: me.firewall_type,
                        allow_iface: me.allow_iface,
                        base_url: me.base_url,
                        list_refs_url: me.list_refs_url,
                    });
                    win.on('destroy', reload);
                    win.show();
                },
            });

            var run_copy_editor = function () {
                let rec = sm.getSelection()[0];
                if (!rec) {
                    return;
                }
                let type = rec.data.type;
                if (!(type === 'in' || type === 'out' || type === 'forward')) {
                    return;
                }

                let win = Ext.create('PVE.FirewallRuleEdit', {
                    firewall_type: me.firewall_type,
                    allow_iface: me.allow_iface,
                    base_url: me.base_url,
                    list_refs_url: me.list_refs_url,
                    rec: rec,
                });
                win.show();
                win.on('destroy', reload);
            };

            me.copyBtn = Ext.create('Proxmox.button.Button', {
                text: gettext('Copy'),
                selModel: sm,
                enableFn: ({ data }) =>
                    (data.type === 'in' || data.type === 'out' || data.type === 'forward') &&
                    me.canEdit,
                disabled: true,
                handler: run_copy_editor,
            });

            if (me.allow_groups) {
                me.groupBtn = Ext.create('Ext.Button', {
                    text: gettext('Insert') + ': ' + gettext('Security Group'),
                    disabled: true,
                    handler: function () {
                        var win = Ext.create('PVE.FirewallGroupRuleEdit', {
                            allow_iface: me.allow_iface,
                            base_url: me.base_url,
                        });
                        win.on('destroy', reload);
                        win.show();
                    },
                });
            }

            me.removeBtn = Ext.create('Proxmox.button.StdRemoveButton', {
                enableFn: (rec) => me.canEdit,
                selModel: sm,
                baseurl: me.base_url + '/',
                confirmMsg: false,
                getRecordName: function (rec) {
                    var rule = rec.data;
                    return rule.pos.toString() + '?digest=' + encodeURIComponent(rule.digest);
                },
                callback: function () {
                    me.store.load();
                },
            });

            let tbar = me.tbar_prefix ? [me.tbar_prefix] : [];
            tbar.push(me.addBtn, me.copyBtn);
            if (me.groupBtn) {
                tbar.push(me.groupBtn);
            }
            tbar.push(me.removeBtn, me.editBtn);

            let render_errors = function (name, value, metaData, record) {
                let errors = record.data.errors;
                if (errors && errors[name]) {
                    metaData.tdCls = 'proxmox-invalid-row';
                    let html = Ext.htmlEncode(`<p>${Ext.htmlEncode(errors[name])}`);
                    metaData.tdAttr =
                        'data-qwidth=600 data-qtitle="ERROR" data-qtip="' + html + '"';
                }
                return Ext.htmlEncode(value);
            };

            let columns = [
                {
                    // similar to xtype: 'rownumberer',
                    dataIndex: 'pos',
                    resizable: false,
                    minWidth: 65,
                    maxWidth: 83,
                    flex: 1,
                    sortable: false,
                    hideable: false,
                    menuDisabled: true,
                    renderer: function (value, metaData, record, rowIdx, colIdx) {
                        metaData.tdCls = Ext.baseCSSPrefix + 'grid-cell-special';
                        let dragHandle =
                            "<i class='pve-grid-fa fa fa-fw fa-reorder cursor-move'></i>";
                        if (value >= 0) {
                            return dragHandle + value;
                        }
                        return dragHandle;
                    },
                },
                {
                    xtype: 'checkcolumn',
                    header: gettext('On'),
                    dataIndex: 'enable',
                    listeners: {
                        checkchange: function (column, recordIndex, checked) {
                            var record = me.getStore().getData().items[recordIndex];
                            record.commit();
                            var data = {};
                            Ext.Array.forEach(record.getFields(), function (field) {
                                data[field.name] = record.get(field.name);
                            });
                            if (!me.allow_iface || !data.iface) {
                                delete data.iface;
                            }
                            me.updateRule(data);
                        },
                    },
                    width: 40,
                },
                {
                    header: gettext('Type'),
                    dataIndex: 'type',
                    renderer: function (value, metaData, record) {
                        return render_errors('type', value, metaData, record);
                    },
                    minWidth: 60,
                    maxWidth: 80,
                    flex: 2,
                },
                {
                    header: gettext('Action'),
                    dataIndex: 'action',
                    renderer: function (value, metaData, record) {
                        return render_errors('action', value, metaData, record);
                    },
                    minWidth: 80,
                    maxWidth: 200,
                    flex: 2,
                },
                {
                    header: gettext('Macro'),
                    dataIndex: 'macro',
                    renderer: function (value, metaData, record) {
                        return render_errors('macro', value, metaData, record);
                    },
                    minWidth: 80,
                    flex: 2,
                },
            ];

            if (me.allow_iface) {
                columns.push({
                    header: gettext('Interface'),
                    dataIndex: 'iface',
                    renderer: function (value, metaData, record) {
                        return render_errors('iface', value, metaData, record);
                    },
                    minWidth: 80,
                    flex: 2,
                });
            }

            columns.push(
                {
                    header: gettext('Protocol'),
                    dataIndex: 'proto',
                    renderer: function (value, metaData, record) {
                        return render_errors('proto', value, metaData, record);
                    },
                    width: 75,
                },
                {
                    header: gettext('Source'),
                    dataIndex: 'source',
                    renderer: function (value, metaData, record) {
                        return render_errors('source', value, metaData, record);
                    },
                    minWidth: 100,
                    flex: 2,
                },
                {
                    header: gettext('S.Port'),
                    dataIndex: 'sport',
                    renderer: function (value, metaData, record) {
                        return render_errors('sport', value, metaData, record);
                    },
                    width: 75,
                },
                {
                    header: gettext('Destination'),
                    dataIndex: 'dest',
                    renderer: function (value, metaData, record) {
                        return render_errors('dest', value, metaData, record);
                    },
                    minWidth: 100,
                    flex: 2,
                },
                {
                    header: gettext('D.Port'),
                    dataIndex: 'dport',
                    renderer: function (value, metaData, record) {
                        return render_errors('dport', value, metaData, record);
                    },
                    width: 75,
                },
                {
                    header: gettext('Log level'),
                    dataIndex: 'log',
                    renderer: function (value, metaData, record) {
                        return render_errors('log', value, metaData, record);
                    },
                    width: 100,
                },
                {
                    header: gettext('Comment'),
                    dataIndex: 'comment',
                    flex: 10,
                    minWidth: 75,
                    renderer: function (value, metaData, record) {
                        let comment = render_errors('comment', value, metaData, record) || '';
                        if (comment.length * 12 > metaData.column.cellWidth) {
                            comment = `<span data-qtip="${Ext.htmlEncode(comment)}">${comment}</span>`;
                        }
                        return comment;
                    },
                },
            );

            Ext.apply(me, {
                store: store,
                selModel: sm,
                tbar: tbar,
                viewConfig: {
                    plugins: [
                        {
                            ptype: 'gridviewdragdrop',
                            dragGroup: 'FWRuleDDGroup',
                            dropGroup: 'FWRuleDDGroup',
                        },
                    ],
                    listeners: {
                        beforedrop: function (node, data, dropRec, dropPosition) {
                            if (!dropRec) {
                                return false; // empty view
                            }
                            let moveto = dropRec.get('pos');
                            if (dropPosition === 'after') {
                                moveto++;
                            }
                            let pos = data.records[0].get('pos');
                            me.moveRule(pos, moveto);
                            return 0;
                        },
                        itemdblclick: run_editor,
                    },
                },
                sortableColumns: false,
                columns: columns,
            });

            me.callParent();

            if (me.base_url) {
                me.setBaseUrl(me.base_url); // load
            }
        },
    },
    function () {
        Ext.define('pve-fw-rule', {
            extend: 'Ext.data.Model',
            fields: [
                { name: 'enable', type: 'boolean' },
                'type',
                'action',
                'macro',
                'source',
                'dest',
                'proto',
                'iface',
                'dport',
                'sport',
                'comment',
                'pos',
                'digest',
                'errors',
            ],
            idProperty: 'pos',
        });
    },
);

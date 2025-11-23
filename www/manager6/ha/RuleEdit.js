Ext.define('PVE.ha.RuleInputPanel', {
    extend: 'Proxmox.panel.InputPanel',

    onlineHelp: 'ha_manager_rules',

    formatResourceListString: function (resources) {
        let me = this;

        return resources.map((vmid) => {
            if (me.resourcesStore.getById(`qemu/${vmid}`)) {
                return `vm:${vmid}`;
            } else if (me.resourcesStore.getById(`lxc/${vmid}`)) {
                return `ct:${vmid}`;
            } else {
                Ext.Msg.alert(gettext('Error'), `Could not find resource type for ${vmid}`);
                throw `Unknown resource type: ${vmid}`;
            }
        });
    },

    onGetValues: function (values) {
        let me = this;

        values.type = me.ruleType;

        if (me.isCreate) {
            values.rule = 'ha-rule-' + Ext.data.identifier.Uuid.Global.generate().slice(0, 13);
        }

        if (values.enable) {
            if (!me.isCreate) {
                Proxmox.Utils.assemble_field_data(values, { delete: 'disable' });
            }
        } else {
            values.disable = 1;
        }
        delete values.enable;

        values.resources = me.formatResourceListString(values.resources);

        return values;
    },

    initComponent: function () {
        let me = this;

        let resourcesStore = Ext.create('Ext.data.Store', {
            model: 'PVEResources',
            autoLoad: true,
            sorters: 'vmid',
            filters: [
                {
                    property: 'type',
                    value: /lxc|qemu/,
                },
                {
                    property: 'hastate',
                    operator: '!=',
                    value: 'unmanaged',
                },
            ],
        });

        Ext.apply(me, {
            resourcesStore: resourcesStore,
        });

        me.column1 = me.column1 ?? [];
        me.column1.unshift(
            {
                xtype: 'proxmoxcheckbox',
                name: 'enable',
                fieldLabel: gettext('Enable'),
                uncheckedValue: 0,
                defaultValue: 1,
                checked: true,
            },
            {
                xtype: 'vmComboSelector',
                name: 'resources',
                fieldLabel: gettext('HA Resources'),
                store: me.resourcesStore,
                allowBlank: false,
                autoSelect: false,
                multiSelect: true,
                validateExists: true,
            },
        );

        me.column2 = me.column2 ?? [];

        me.columnB = me.columnB ?? [];
        me.columnB.unshift({
            xtype: 'textfield',
            name: 'comment',
            fieldLabel: gettext('Comment'),
            allowBlank: true,
        });

        me.callParent();
    },
});

Ext.define('PVE.ha.RuleEdit', {
    extend: 'Proxmox.window.Edit',

    defaultFocus: undefined, // prevent the vmComboSelector to be expanded when focusing the window

    initComponent: function () {
        let me = this;

        me.isCreate = !me.ruleId;

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/ha/rules';
            me.method = 'POST';
        } else {
            me.url = `/api2/extjs/cluster/ha/rules/${me.ruleId}`;
            me.method = 'PUT';
        }

        let inputPanel = Ext.create(me.panelType, {
            ruleId: me.ruleId,
            ruleType: me.ruleType,
            isCreate: me.isCreate,
        });

        Ext.apply(me, {
            subject: me.panelName,
            isAdd: true,
            items: [inputPanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: (response, options) => {
                    let values = response.result.data;

                    values.resources = values.resources
                        .split(',')
                        .map((resource) => resource.split(':')[1]);

                    values.enable = values.disable ? 0 : 1;

                    inputPanel.setValues(values);
                },
            });
        }
    },
});

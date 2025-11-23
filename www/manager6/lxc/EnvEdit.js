Ext.define('PVE.lxc.EnvVariableField', {
    extend: 'Ext.form.FieldContainer',
    mixins: {
        field: 'Ext.form.field.Field',
    },
    xtype: 'pveLxcEnvVariableField',

    name: 'variable',

    layout: {
        type: 'hbox',
        align: 'stretch',
    },

    config: {
        value: null,
    },

    // called when X icon-button is clicked, with this field as argument.
    onRemove: Ext.emptyFn,

    setValue: function (nameValue) {
        let me = this;
        let viewModel = me.getViewModel();

        me.value = nameValue;
        let [name, value] = nameValue?.split('=') ?? ['', ''];

        viewModel.set('value', value);
        viewModel.set('name', name);

        // TODO: sub-fields might not be available when this is called, so we cannot just set the
        // value on field directly or call resetOriginalValue for correct reset orig. val. behavior
        me.resetOriginalValue();
    },

    getValue: function () {
        let viewModel = this.getViewModel();
        let name = viewModel.get('name');
        let value = viewModel.get('value') ?? '';

        return name?.length ? `${name}=${value}` : '';
    },

    viewModel: {
        parent: null,
        data: {
            name: '',
            value: '',
        },
        formulas: {
            valueEmpty: (get) => !get('value')?.length,
        },
    },

    defaultType: 'textfield',
    items: [
        {
            xtype: 'proxmoxtextfield',
            emptyText: gettext('Name'),
            bind: {
                allowBlank: '{valueEmpty}',
                value: '{name}',
            },
            submitValue: false,
            flex: 2,
        },
        {
            xtype: 'box',
            html: '=',
            padding: '0 5',
        },
        {
            xtype: 'proxmoxtextfield',
            emptyText: gettext('Value'),
            bind: {
                value: '{value}',
            },
            submitValue: false,
            flex: 3,
        },
        {
            xtype: 'button',
            cls: 'x-btn-default-toolbar-small proxmox-inline-button',
            iconCls: 'x-btn-icon-el-default-toolbar-small fa fa-trash-o',
            handler: function (button, event) {
                let field = button.up('pveLxcEnvVariableField');
                field.onRemove.call(field, field);
            },
        },
    ],
});

Ext.define('PVE.lxc.EnvInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveLxcEnvInputPanel',
    onlineHelp: 'pct_options',

    onGetValues: function (formValues) {
        let variables = formValues?.variable;
        if (typeof variables === 'string') {
            variables = [variables];
        }
        variables = variables?.filter((v) => typeof v === 'string' && v.length);

        let submitValues = {};
        if (variables?.length) {
            submitValues.env = variables.join('\0');
        } else {
            submitValues.delete = 'env';
        }

        return submitValues;
    },

    items: [
        {
            xtype: 'fieldcontainer',
            layout: {
                type: 'hbox',
                align: 'stretch',
            },
            defaults: {
                padding: '0 4',
            },
            items: [
                {
                    xtype: 'displayfield',
                    flex: 2,
                    value: gettext('Name'),
                },
                {
                    xtype: 'box',
                    html: ' ',
                },
                {
                    xtype: 'displayfield',
                    flex: 3,
                    value: gettext('Value'),
                },
            ],
        },
        {
            xtype: 'container',
            name: 'variableContainer',
            layout: 'anchor',
            items: [],
        },
        {
            xtype: 'fieldcontainer',
            layout: {
                type: 'hbox',
                align: 'start',
            },
            items: {
                xtype: 'button',
                text: gettext('Add Variable'),
                handler: function (button, event) {
                    let variableContainer = button
                        .up('pveLxcEnvInputPanel')
                        .down('container[name=variableContainer]');

                    variableContainer.add(
                        Ext.create({
                            xtype: 'pveLxcEnvVariableField',
                            onRemove: (field) => variableContainer.remove(field),
                        }),
                    );
                },
            },
        },
    ],

    setValues: function (values) {
        let me = this;

        me.env = values; // TODO: needed?

        let variableContainer = me.down('container[name=variableContainer]');

        values.env?.split(/\0+/).forEach((value) => {
            variableContainer.add(
                Ext.create({
                    xtype: 'pveLxcEnvVariableField',
                    onRemove: (field) => variableContainer.remove(field),
                    value,
                }),
            );
        });
    },

    initComponent: function () {
        let me = this;
        me.mounts = []; // reset state

        me.callParent();
    },
});

Ext.define('PVE.lxc.EnvEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveLxcEnvEdit',

    subject: gettext('Environment'),
    autoLoad: true,
    width: 720,

    showReset: false, // TODO: fix reset handling for EnvVar inputpanel/fields.

    items: [
        {
            xtype: 'pveLxcEnvInputPanel',
        },
    ],
});
